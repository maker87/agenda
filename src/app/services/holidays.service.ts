import { Injectable } from '@angular/core';

export interface Holiday {
  name: string;
  date: string; // YYYY-MM-DD
  type: 'national' | 'regional' | 'observance';
}

export interface RegionOption {
  code: string;
  label: string;
}

export const REGIONS: RegionOption[] = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
  { code: 'AR', label: 'Argentina' },
  { code: 'CO', label: 'Colombia' },
  { code: 'AU', label: 'Australia' },
  { code: 'IN', label: 'India' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'CN', label: 'China' },
  { code: 'SE', label: 'Sweden' },
  { code: 'PL', label: 'Poland' },
  { code: 'TR', label: 'Turkey' },
];

function y(): number {
  return new Date().getFullYear();
}

function d(month: number, day: number): string {
  return `${y()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

