export interface SkillParameter {
    readonly name: string;
    readonly description: string;
    readonly type: string;
}

export interface OptionalSkillParameter extends SkillParameter {
    readonly defaultValue: string;
}

export interface ParsedSkill {
    readonly title: string;
    readonly introduction: string;
    readonly requiredVars: readonly SkillParameter[];
    readonly optionalVars: readonly OptionalSkillParameter[];
}

function extractTitle(lines: readonly string[]): string {
    const titleLine: string | undefined = lines.find((l: string) => /^# /.test(l));
    return titleLine ? titleLine.replace(/^# /, '').trim() : "TITLE DOESN'T EXIST IN SKILL";
}

function extractIntroduction(lines: readonly string[]): string {
    const titleIndex: number = lines.findIndex((l: string) => /^# /.test(l));
    if (titleIndex === -1) return "INTRODUCTION DOESN'T EXIST IN SKILL";

    const afterTitle: readonly string[] = lines.slice(titleIndex + 1);
    const stopIndex: number = afterTitle.findIndex((l: string) => /^(Required|Optional):/.test(l.trim()));
    const candidates: readonly string[] = stopIndex === -1 ? afterTitle : afterTitle.slice(0, stopIndex);
    const joined: string = candidates.join('\n').trim();
    return joined || "INTRODUCTION DOESN'T EXIST IN SKILL";
}

function extractParameterBlocks(lines: readonly string[], sectionHeader: string, stopHeader: string): readonly (readonly string[])[] {
    const sectionIndex: number = lines.findIndex((l: string) => l.trim() === sectionHeader);
    if (sectionIndex === -1) return [];

    const afterSection: readonly string[] = lines.slice(sectionIndex + 1);
    const stopIndex: number = afterSection.findIndex((l: string) => {
        const trimmed: string = l.trim();
        return trimmed === stopHeader;
    });
    const sectionLines: readonly string[] = stopIndex === -1 ? afterSection : afterSection.slice(0, stopIndex);

    const trimmedLines: readonly string[] = sectionLines.map((l: string) => l.trim());
    const joinedContent: string = trimmedLines.join('\n');
    const rawBlocks: readonly string[] = joinedContent.split(/\n{2,}/);

    return rawBlocks
        .map((block: string) => block.split('\n').filter((l: string) => l !== ''))
        .filter((block: readonly string[]) => block.length > 0);
}

function extractRequiredVars(lines: readonly string[]): readonly SkillParameter[] {
    const blocks: readonly (readonly string[])[] = extractParameterBlocks(lines, 'Required:', 'Optional:');
    return blocks.reduce<readonly SkillParameter[]>((acc: readonly SkillParameter[], block: readonly string[]) => {
        if (block.length < 3) return acc;
        const match: RegExpMatchArray | null = block[0].match(/^\{\{([A-Z_][A-Z0-9_]*)\}\}$/);
        if (!match) return acc;
        return [...acc, { name: match[1], description: block[1], type: block[2] }];
    }, []);
}

function extractOptionalVars(lines: readonly string[]): readonly OptionalSkillParameter[] {
    const blocks: readonly (readonly string[])[] = extractParameterBlocks(lines, 'Optional:', 'Required:');
    return blocks.reduce<readonly OptionalSkillParameter[]>((acc: readonly OptionalSkillParameter[], block: readonly string[]) => {
        if (block.length < 3) return acc;
        const match: RegExpMatchArray | null = block[0].match(/^\{\{([A-Z_][A-Z0-9_]*)=(.+)\}\}$/);
        if (!match) return acc;
        return [...acc, { name: match[1], defaultValue: match[2], description: block[1], type: block[2] }];
    }, []);
}

export function parseSkillFile(content: string): ParsedSkill {
    const lines: readonly string[] = content.split('\n');

    return {
        title: extractTitle(lines),
        introduction: extractIntroduction(lines),
        requiredVars: extractRequiredVars(lines),
        optionalVars: extractOptionalVars(lines),
    };
}

export function formatParsedSkillSummary(skill: ParsedSkill, skillPath?: string): string {
    const parts: readonly string[] = [
        `# ${skill.title}`,
        ...(skillPath ? [`Skill path = ${skillPath}`] : []),
        ...(skill.introduction ? [skill.introduction] : []),
        ...(skill.requiredVars.length > 0
            ? [`Required:\n${skill.requiredVars
                .map((v: SkillParameter) => `{{${v.name}}}\n${v.description}\n${v.type}`)
                .join('\n\n')}`]
            : []),
        ...(skill.optionalVars.length > 0
            ? [`Optional:\n${skill.optionalVars
                .map((v: OptionalSkillParameter) => `{{${v.name}=${v.defaultValue}}}\n${v.description}\n${v.type}`)
                .join('\n\n')}`]
            : []),
    ];

    return parts.join('\n\n');
}
