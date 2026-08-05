import { describe, it, expect } from 'vitest';
import { shanghaiCutoff, shanghaiHourString, normalizeKeyword } from '../../services/trending';

// Fixed reference: 2024-01-15T12:34:56Z UTC = 2024-01-15 20:34:56 Shanghai
const FIXED = new Date('2024-01-15T12:34:56Z');

describe('trending date helpers', () => {
  it('shanghaiCutoff subtracts hours and zeroes minutes/seconds', () => {
    expect(shanghaiCutoff(24, FIXED)).toBe('2024-01-14 20:00:00');
  });

  it('shanghaiCutoff(0) truncates to the current Shanghai hour', () => {
    expect(shanghaiCutoff(0, FIXED)).toBe('2024-01-15 20:00:00');
  });

  it('shanghaiCutoff pads month/day/hour with leading zeros', () => {
    const edge = new Date('2024-01-05T03:05:00Z'); // 11:05 Shanghai
    expect(shanghaiCutoff(0, edge)).toBe('2024-01-05 11:00:00');
  });

  it('shanghaiCutoff crosses midnight correctly', () => {
    // 2024-01-15T20:30:00Z = 2024-01-16 04:30 Shanghai; 6h ago = 2024-01-15 22:00
    const late = new Date('2024-01-15T20:30:00Z');
    expect(shanghaiCutoff(6, late)).toBe('2024-01-15 22:00:00');
  });

  it('shanghaiHourString returns Shanghai time as YYYY-MM-DD HH:MM:SS', () => {
    expect(shanghaiHourString(FIXED)).toBe('2024-01-15 20:34:56');
  });

  it('normalizeKeyword lowercases, strips symbols, collapses underscores', () => {
    expect(normalizeKeyword('  AI Model! ')).toBe('ai_model');
    expect(normalizeKeyword('量子计算。')).toBe('量子计算');
    expect(normalizeKeyword('  OpenAI GPT-5  ')).toBe('openai_gpt5');
  });

  it('normalizeKeyword trims leading/trailing underscores', () => {
    expect(normalizeKeyword('!!hello##')).toBe('hello');
    expect(normalizeKeyword('---')).toBe('');
  });
});
