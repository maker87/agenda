import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLES = {
  event: process.env.CALENDAR_EVENT_TABLE,
  notification: process.env.NOTIFICATION_TABLE,
  streak: process.env.STREAK_TABLE,
  apiToken: process.env.API_TOKEN_TABLE,
};

const SERVER_INFO = { name: 'agenda-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

// ── Auth ─────────────────────────────────────────────────────────────────

/**
 * Resolves the bearer token in the Authorization header to the owning
 * account's email. The token table is expected to stay small (one row per
 * user who's generated a personal access token), so a full scan+filter is
 * simpler and safer here than depending on Amplify's internally-generated
 * GSI names for a hand-rolled DynamoDB query.
 */
async function resolveOwner(headers) {
  const auth = headers['authorization'] || headers['Authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const { Items } = await ddb.send(new ScanCommand({
    TableName: TABLES.apiToken,
    FilterExpression: '#t = :token',
    ExpressionAttributeNames: { '#t': 'token' },
    ExpressionAttributeValues: { ':token': token },
  }));
  return Items?.[0]?.ownerEmail ?? null;
}

// ── Tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_events',
    description: "List the user's calendar events, optionally filtered to a date range (YYYY-MM-DD, inclusive).",
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD, inclusive lower bound' },
        endDate: { type: 'string', description: 'YYYY-MM-DD, inclusive upper bound' },
      },
    },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        startTime: { type: 'string', description: 'HH:MM (24h)' },
        endTime: { type: 'string', description: 'HH:MM (24h)' },
        category: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'date', 'startTime', 'endTime'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete a calendar event, identified by its exact title and date.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'reschedule_event',
    description: 'Move an existing event to a new date/time, identified by its current exact title and date.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'Current date, YYYY-MM-DD' },
        newDate: { type: 'string', description: 'YYYY-MM-DD' },
        newStartTime: { type: 'string', description: 'HH:MM (24h)' },
        newEndTime: { type: 'string', description: 'HH:MM (24h)' },
      },
      required: ['title', 'date', 'newDate', 'newStartTime', 'newEndTime'],
    },
  },
  {
    name: 'list_reminders',
    description: "List the user's reminders.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_reminder',
    description: 'Create a new reminder notification.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_streaks',
    description: "List the user's active habit streaks, including target, unit, and logged progress.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'log_streak',
    description: 'Log a value for a habit streak on a given date, identified by its exact name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, must not be in the future' },
        value: { type: 'number' },
      },
      required: ['name', 'date', 'value'],
    },
  },
];

// ── Tool implementations ─────────────────────────────────────────────────

async function scanOwned(table, ownerField, ownerEmail, extraFilter) {
  const { Items } = await ddb.send(new ScanCommand({
    TableName: table,
    FilterExpression: extraFilter ? `#o = :owner AND ${extraFilter.expr}` : '#o = :owner',
    ExpressionAttributeNames: { '#o': ownerField, ...(extraFilter?.names ?? {}) },
    ExpressionAttributeValues: { ':owner': ownerEmail, ...(extraFilter?.values ?? {}) },
  }));
  return Items ?? [];
}

async function toolListEvents(ownerEmail, args) {
  let events = await scanOwned(TABLES.event, 'ownerEmail', ownerEmail);
  if (args.startDate) events = events.filter(e => e.date >= args.startDate);
  if (args.endDate) events = events.filter(e => e.date <= args.endDate);
  events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return events.map(e => ({
    title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime,
    category: e.category, description: e.description,
  }));
}

async function toolCreateEvent(ownerEmail, args) {
  const item = {
    id: randomUUID(),
    ownerEmail,
    title: args.title,
    date: args.date,
    startTime: args.startTime,
    endTime: args.endTime,
    category: args.category ?? '',
    description: args.description ?? '',
    color: '#6c63ff',
    sharedWith: [],
  };
  await ddb.send(new PutCommand({ TableName: TABLES.event, Item: item }));
  return { created: true, title: item.title, date: item.date };
}

/** Same exact/fallback matching contract the in-app AI assistant uses for delete/reschedule. */
function findEventMatch(events, title, date) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const wantTitle = norm(title);
  const exact = events.find(e => norm(e.title) === wantTitle && e.date === date);
  if (exact) return exact;
  const onDate = events.filter(e => e.date === date);
  if (onDate.length === 1) return onDate[0];
  const byTitle = events.filter(e => norm(e.title) === wantTitle);
  if (byTitle.length === 1) return byTitle[0];
  return null;
}

async function toolDeleteEvent(ownerEmail, args) {
  const events = await scanOwned(TABLES.event, 'ownerEmail', ownerEmail);
  const match = findEventMatch(events, args.title, args.date);
  if (!match) {
    const onDate = events.filter(e => e.date === args.date).map(e => e.title);
    return { deleted: false, reason: onDate.length ? `No exact match. Events on ${args.date}: ${onDate.join(', ')}` : `No events found on ${args.date}.` };
  }
  await ddb.send(new DeleteCommand({ TableName: TABLES.event, Key: { id: match.id } }));
  return { deleted: true, title: match.title, date: match.date };
}

async function toolRescheduleEvent(ownerEmail, args) {
  const events = await scanOwned(TABLES.event, 'ownerEmail', ownerEmail);
  const match = findEventMatch(events, args.title, args.date);
  if (!match) {
    const onDate = events.filter(e => e.date === args.date).map(e => e.title);
    return { rescheduled: false, reason: onDate.length ? `No exact match. Events on ${args.date}: ${onDate.join(', ')}` : `No events found on ${args.date}.` };
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLES.event,
    Key: { id: match.id },
    UpdateExpression: 'SET #d = :d, startTime = :st, endTime = :et',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':d': args.newDate, ':st': args.newStartTime, ':et': args.newEndTime },
  }));
  return { rescheduled: true, title: match.title, newDate: args.newDate, newStartTime: args.newStartTime, newEndTime: args.newEndTime };
}

async function toolListReminders(ownerEmail) {
  const notifs = await scanOwned(TABLES.notification, 'recipientEmail', ownerEmail, {
    expr: '#type = :type', names: { '#type': 'type' }, values: { ':type': 'reminder' },
  });
  return notifs.map(n => ({ title: n.title, body: n.body, read: !!n.read, createdAt: n.createdAt }));
}

async function toolCreateReminder(ownerEmail, args) {
  const item = {
    id: randomUUID(),
    recipientEmail: ownerEmail,
    type: 'reminder',
    title: args.title,
    body: args.body ?? '',
    senderEmail: 'mcp',
    read: false,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLES.notification, Item: item }));
  return { created: true, title: item.title };
}

async function toolListStreaks(ownerEmail) {
  const streaks = await scanOwned(TABLES.streak, 'ownerEmail', ownerEmail);
  return streaks.filter(s => !s.deletedAt).map(s => ({
    name: s.name, target: s.target, unit: s.unit,
    checkedDays: s.checkedDays ?? [], loggedValues: s.loggedValues ?? {},
  }));
}

async function toolLogStreak(ownerEmail, args) {
  if (args.date > new Date().toISOString().split('T')[0]) {
    return { logged: false, reason: 'Date cannot be in the future.' };
  }
  const streaks = await scanOwned(TABLES.streak, 'ownerEmail', ownerEmail);
  const match = streaks.find(s => !s.deletedAt && (s.name || '').trim().toLowerCase() === args.name.trim().toLowerCase());
  if (!match) return { logged: false, reason: `No streak named "${args.name}" found.` };

  const loggedValues = { ...(match.loggedValues ?? {}), [args.date]: args.value };
  const checkedDays = new Set(match.checkedDays ?? []);
  if (args.value >= match.target) checkedDays.add(args.date); else checkedDays.delete(args.date);

  await ddb.send(new UpdateCommand({
    TableName: TABLES.streak,
    Key: { id: match.id },
    UpdateExpression: 'SET loggedValues = :lv, checkedDays = :cd',
    ExpressionAttributeValues: { ':lv': loggedValues, ':cd': [...checkedDays].sort() },
  }));
  return { logged: true, name: match.name, date: args.date, value: args.value };
}

const TOOL_HANDLERS = {
  list_events: toolListEvents,
  create_event: toolCreateEvent,
  delete_event: toolDeleteEvent,
  reschedule_event: toolRescheduleEvent,
  list_reminders: toolListReminders,
  create_reminder: toolCreateReminder,
  list_streaks: toolListStreaks,
  log_streak: toolLogStreak,
};

// ── JSON-RPC / MCP protocol ──────────────────────────────────────────────

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleRpc(message, ownerEmail) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null; // notifications carry no id and get no response
  }
  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }
  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }
  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolHandler = TOOL_HANDLERS[toolName];
    if (!toolHandler) {
      return jsonRpcResult(id, { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true });
    }
    try {
      const result = await toolHandler(ownerEmail, params?.arguments ?? {});
      return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (err) {
      console.error('Tool call error:', toolName, err);
      return jsonRpcResult(id, { content: [{ type: 'text', text: `Error running ${toolName}.` }], isError: true });
    }
  }

  return jsonRpcError(id ?? null, -32601, `Method not found: ${method}`);
}

// ── Lambda Function URL entry point ──────────────────────────────────────

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;

  if (method !== 'POST') {
    // Streamable HTTP servers that don't support server-initiated SSE
    // streams may return 405 for GET — conformant clients fall back to
    // per-request POSTs, which is all this stateless server supports.
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = event.headers ?? {};
  const ownerEmail = await resolveOwner(headers);
  if (!ownerEmail) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized — missing or invalid bearer token.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify(jsonRpcError(null, -32700, 'Parse error')) };
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const res = await handleRpc(msg, ownerEmail);
    if (res) responses.push(res);
  }

  if (responses.length === 0) {
    return { statusCode: 202, body: '' };
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Array.isArray(body) ? responses : responses[0]),
  };
};
