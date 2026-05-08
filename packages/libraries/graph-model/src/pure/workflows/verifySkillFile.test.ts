import { describe, it, expect } from 'vitest';
import type { VerificationResult } from './verifySkillFile';
import { verifySkillFile } from './verifySkillFile';

describe('verifySkillFile', () => {
    it('passes a valid SKILL.md', () => {
        const content: string = `# My Skill

This skill does something useful.

Required:
{{INPUT}}
The input data to process
string

Optional:
{{VERBOSE=false}}
Whether to output verbose logs
boolean`;
        const result: VerificationResult = verifySkillFile(content);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('fails when Skill path is present', () => {
        const content: string = `# My Skill

Skill path = /some/path
This skill does something.

Required:
{{INPUT}}
The input data
string`;
        const result: VerificationResult = verifySkillFile(content);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('SKILL.md must not contain "Skill path = ..." — the path is injected at runtime by the extractor');
    });

    it('fails when title is missing', () => {
        const content: string = `Some text without a heading`;
        const result: VerificationResult = verifySkillFile(content);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Missing title: SKILL.md must start with a # heading');
    });

    it('fails when list-style parameters are used', () => {
        const content: string = `# My Skill

Intro text

Required:
- {{INPUT}}`;
        const result: VerificationResult = verifySkillFile(content);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e: string) => e.includes('list-item format'))).toBe(true);
    });

    it('fails when parameter block is incomplete (missing desc/type)', () => {
        const content: string = `# My Skill

Intro text

Required:
{{INPUT}}`;
        const result: VerificationResult = verifySkillFile(content);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e: string) => e.includes('missing description and type'))).toBe(true);
    });

    it('passes with no parameters', () => {
        const content: string = `# My Skill

This skill has no parameters.`;
        const result: VerificationResult = verifySkillFile(content);
        expect(result.valid).toBe(true);
    });
});
