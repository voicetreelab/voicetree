import { describe, it, expect } from 'vitest';
import type { ParsedSkill } from './parseSkillFile';
import { parseSkillFile, formatParsedSkillSummary } from './parseSkillFile';

const FULL_SKILL: string = `# Software Engineering Feature Skill

This skill is for solving problems and implementing features.

Required:
{{FEATURE_SPEC}}
The specification of the feature to implement
string

{{INTERNAL_TERMS}}
Internal terms and definitions used in the codebase
string

Optional:
{{DOCUMENTATION=true}}
Whether to generate documentation
boolean

{{DEPTH=2}}
How deep to analyze dependencies
integer

{{STYLE=concise}}
The writing style for generated content
string`;

describe('parseSkillFile', () => {
    it('parses a full valid SKILL.md', () => {
        const result: ParsedSkill = parseSkillFile(FULL_SKILL);
        expect(result.title).toBe('Software Engineering Feature Skill');
        expect(result.introduction).toBe('This skill is for solving problems and implementing features.');
        expect(result.requiredVars).toEqual([
            { name: 'FEATURE_SPEC', description: 'The specification of the feature to implement', type: 'string' },
            { name: 'INTERNAL_TERMS', description: 'Internal terms and definitions used in the codebase', type: 'string' },
        ]);
        expect(result.optionalVars).toEqual([
            { name: 'DOCUMENTATION', defaultValue: 'true', description: 'Whether to generate documentation', type: 'boolean' },
            { name: 'DEPTH', defaultValue: '2', description: 'How deep to analyze dependencies', type: 'integer' },
            { name: 'STYLE', defaultValue: 'concise', description: 'The writing style for generated content', type: 'string' },
        ]);
    });

    it('handles missing title', () => {
        const content: string = `Some intro text

Required:
{{VAR1}}
A variable
string`;
        const result: ParsedSkill = parseSkillFile(content);
        expect(result.title).toBe("TITLE DOESN'T EXIST IN SKILL");
    });

    it('handles missing Required and Optional sections', () => {
        const content: string = `# My Skill

Just some intro text with no variables.`;
        const result: ParsedSkill = parseSkillFile(content);
        expect(result.requiredVars).toEqual([]);
        expect(result.optionalVars).toEqual([]);
        expect(result.introduction).toContain('Just some intro text');
    });

    it('handles empty content', () => {
        const result: ParsedSkill = parseSkillFile('');
        expect(result.title).toBe("TITLE DOESN'T EXIST IN SKILL");
        expect(result.introduction).toBe("INTRODUCTION DOESN'T EXIST IN SKILL");
        expect(result.requiredVars).toEqual([]);
        expect(result.optionalVars).toEqual([]);
    });

    it('handles missing introduction (title directly followed by Required)', () => {
        const content: string = `# My Skill
Required:
{{VAR1}}
A variable
string`;
        const result: ParsedSkill = parseSkillFile(content);
        expect(result.introduction).toBe("INTRODUCTION DOESN'T EXIST IN SKILL");
    });

    it('skips parameter blocks with missing description or type', () => {
        const content: string = `# My Skill

Intro text

Required:
{{GOOD_VAR}}
Has description
string

{{BAD_VAR}}`;
        const result: ParsedSkill = parseSkillFile(content);
        expect(result.requiredVars).toEqual([
            { name: 'GOOD_VAR', description: 'Has description', type: 'string' },
        ]);
    });
});

describe('formatParsedSkillSummary', () => {
    it('formats a full ParsedSkill with required and optional vars', () => {
        const result: string = formatParsedSkillSummary(parseSkillFile(FULL_SKILL));
        expect(result).toBe(`# Software Engineering Feature Skill

This skill is for solving problems and implementing features.

Required:
{{FEATURE_SPEC}}
The specification of the feature to implement
string

{{INTERNAL_TERMS}}
Internal terms and definitions used in the codebase
string

Optional:
{{DOCUMENTATION=true}}
Whether to generate documentation
boolean

{{DEPTH=2}}
How deep to analyze dependencies
integer

{{STYLE=concise}}
The writing style for generated content
string`);
    });

    it('includes skill path when provided, after the title', () => {
        const result: string = formatParsedSkillSummary(parseSkillFile(FULL_SKILL), '/home/user/workflows/my-skill');
        expect(result).toContain('Skill path = /home/user/workflows/my-skill');
        expect(result.startsWith('# Software Engineering Feature Skill')).toBe(true);
        const titleIndex: number = result.indexOf('# Software Engineering Feature Skill');
        const pathIndex: number = result.indexOf('Skill path = ');
        expect(pathIndex).toBeGreaterThan(titleIndex);
    });

    it('omits skill path when not provided', () => {
        const result: string = formatParsedSkillSummary(parseSkillFile(FULL_SKILL));
        expect(result).not.toContain('Skill path = ');
    });

    it('omits Required section when no required vars', () => {
        const skill: ParsedSkill = {
            title: 'Test',
            introduction: 'Intro text',
            requiredVars: [],
            optionalVars: [{ name: 'OPT', defaultValue: 'val', description: 'An option', type: 'string' }],
        };
        const result: string = formatParsedSkillSummary(skill);
        expect(result).not.toContain('Required:');
        expect(result).toContain('Optional:\n{{OPT=val}}\nAn option\nstring');
    });

    it('omits Optional section when no optional vars', () => {
        const skill: ParsedSkill = {
            title: 'Test',
            introduction: 'Intro text',
            requiredVars: [{ name: 'VAR1', description: 'A var', type: 'string' }],
            optionalVars: [],
        };
        const result: string = formatParsedSkillSummary(skill);
        expect(result).toContain('Required:\n{{VAR1}}\nA var\nstring');
        expect(result).not.toContain('Optional:');
    });

    it('omits both sections when no vars', () => {
        const skill: ParsedSkill = {
            title: 'Test',
            introduction: 'Intro text',
            requiredVars: [],
            optionalVars: [],
        };
        const result: string = formatParsedSkillSummary(skill);
        expect(result).toBe('# Test\n\nIntro text');
    });
});
