import { Injectable } from '@angular/core';

export const CATEGORY_SEP = ' > ';

export interface CategoryNode {
  name: string;       // just this segment, e.g. "Clubs"
  fullPath: string;   // full path, e.g. "School > Clubs"
  children: CategoryNode[];
  eventCount?: number;
}

@Injectable({ providedIn: 'root' })
export class CategoryTreeService {

  /** Build a tree from a flat list of path strings. */
  buildTree(paths: string[]): CategoryNode[] {
    const root: CategoryNode[] = [];

    for (const path of paths) {
      if (!path.trim()) continue;
      const segments = path.split(CATEGORY_SEP).map(s => s.trim()).filter(Boolean);
      let level = root;
      let accumulated = '';

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        accumulated = accumulated ? `${accumulated}${CATEGORY_SEP}${seg}` : seg;
        let node = level.find(n => n.name === seg);
        if (!node) {
          node = { name: seg, fullPath: accumulated, children: [] };
          level.push(node);
        }
        level = node.children;
      }
    }

    return root;
  }

  /** Get all unique paths from a tree (leaf and intermediate nodes). */
  getAllPaths(nodes: CategoryNode[]): string[] {
    const result: string[] = [];
    const walk = (list: CategoryNode[]) => {
      for (const n of list) {
        result.push(n.fullPath);
        walk(n.children);
      }
    };
    walk(nodes);
    return result;
  }

  /** Split a path string into its segments. */
  splitPath(path: string): string[] {
    return path.split(CATEGORY_SEP).map(s => s.trim()).filter(Boolean);
  }

  /** Join segments into a path string. */
  joinPath(segments: string[]): string {
    return segments.join(CATEGORY_SEP);
  }

  /** Check if a category path is a descendant of (or equal to) a given ancestor path. */
  isUnderPath(categoryPath: string, ancestorPath: string): boolean {
    if (!ancestorPath) return true;
    return categoryPath === ancestorPath || categoryPath.startsWith(ancestorPath + CATEGORY_SEP);
  }
}
