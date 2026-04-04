import { parseSkillFile } from './parseSkillFile'
import type { ParsedSkill } from './parseSkillFile'

export interface VerificationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

export function verifySkillFile(content: string): VerificationResult {
    const parsed: ParsedSkill = parseSkillFile(content);

    const titleErrors: readonly string[] = parsed.title === "TITLE DOESN'T EXIST IN SKILL"
        ? ['Missing title: SKILL.md must start with a # heading']
        : [];

    const introErrors: readonly string[] = parsed.introduction === "INTRODUCTION DOESN'T EXIST IN SKILL"
        ? ['Missing introduction: SKILL.md must have introductory text after the title']
        : [];

    const pathErrors: readonly string[] = content.includes('Skill path = ')
        ? ['SKILL.md must not contain "Skill path = ..." — the path is injected at runtime by the extractor']
        : [];

    const lines: readonly string[] = content.split('\n');
    const requiredIndex: number = lines.findIndex((l: string) => l.trim() === 'Required:');
    const optionalIndex: number = lines.findIndex((l: string) => l.trim() === 'Optional:');

    const requiredParamErrors: readonly string[] = requiredIndex === -1 ? [] : [
        ...parsed.requiredVars
            .filter((param) => !param.description || !param.type)
            .map((param) => `Required parameter {{${param.name}}} is missing description or type`),
        ...(content.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g) ?? [])
            .filter((raw: string) => !parsed.requiredVars.some((v) => `{{${v.name}}}` === raw))
            .map((raw: string) => `Required parameter ${raw} found but missing description and type lines (expected 3-line block: {{NAME}}, description, type)`),
    ];

    const optionalParamErrors: readonly string[] = optionalIndex === -1 ? [] :
        parsed.optionalVars
            .filter((param) => !param.description || !param.type)
            .map((param) => `Optional parameter {{${param.name}=${param.defaultValue}}} is missing description or type`);

    const listStyleErrors: readonly string[] = /^- \{\{[A-Z_]/m.test(content)
        ? ['Parameters must not use list-item format (- {{...}}). Use block format: {{NAME}} followed by description and type on separate lines']
        : [];

    const errors: readonly string[] = [
        ...titleErrors,
        ...introErrors,
        ...pathErrors,
        ...requiredParamErrors,
        ...optionalParamErrors,
        ...listStyleErrors,
    ];

    return { valid: errors.length === 0, errors };
}
