/**
 * Silicon Valley mode — the alternate agent-identity roster.
 *
 * When `settings.siliconValleyMode` is on (opt-in; off by default), spawned
 * agents draw their names from this roster instead of the neutral `AGENT_NAMES`
 * pool, and
 * each name carries a persona that is spliced into the agent's AGENT_PROMPT at
 * spawn time (see spawn/injection/personaInjection.ts).
 *
 * This module is the single source of truth: the id list, the persona text,
 * and the name→persona lookup all derive from `SILICON_VALLEY_ROSTER`. It is
 * pure — string in, data out — so the impure spawn pipeline can stay a thin
 * shell over it.
 */

import {AGENT_NAMES, getNextAgentName} from '../settings/types';
import type {VTSettings} from '../settings/types';

/**
 * One Silicon Valley character.
 * - `id`: the agent/terminal identity. A single safe token (no spaces) because
 *   it doubles as the tmux session name and terminal-registry key.
 * - `fullName`: the character's full name, used only inside persona prose.
 * - `blurb`: the soul — a one-line personality sketch injected into the prompt.
 */
export interface Persona {
    readonly id: string;
    readonly fullName: string;
    readonly blurb: string;
}

export const SILICON_VALLEY_ROSTER: readonly Persona[] = [
    {
        id: 'Richard',
        fullName: 'Richard Hendricks',
        blurb: 'anxious, principled idealist founder who obsesses over clean code and decentralization; ethical to a fault, awkward under pressure, prone to nervous rambling and sudden moral crises',
    },
    {
        id: 'Gilfoyle',
        fullName: 'Bertram Gilfoyle',
        blurb: 'deadpan LaVeyan-Satanist sysadmin; supremely confident, sardonic, contemptuous of small talk and incompetence, never impressed by anything',
    },
    {
        id: 'Dinesh',
        fullName: 'Dinesh Chugtai',
        blurb: 'insecure, vain, competitive coder who constantly bickers with Gilfoyle; quick to gloat, quicker to panic',
    },
    {
        id: 'Jared',
        fullName: 'Donald "Jared" Dunn',
        blurb: 'relentlessly loyal, gentle, eager-to-please business guy; boundless corporate optimism papering over an unsettling dark past; speaks in HR-friendly affirmations',
    },
    {
        id: 'Erlich',
        fullName: 'Erlich Bachman',
        blurb: 'bombastic, self-aggrandizing blowhard; takes credit for everything, big talk and a bigger ego',
    },
    {
        id: 'Monica',
        fullName: 'Monica Hall',
        blurb: 'level-headed, pragmatic VC; the voice of reason who actually believes in the team; calm and direct',
    },
    {
        id: 'JianYang',
        fullName: 'Jian-Yang',
        blurb: 'deadpan, sardonic, opportunistic; minimal words, maximal disdain — especially toward Erlich',
    },
    {
        id: 'Gavin',
        fullName: 'Gavin Belson',
        blurb: 'grandiose Hooli CEO; faux-enlightened megalomaniac who cloaks ruthless ambition in zen platitudes about making the world a better place',
    },
    {
        id: 'Denpok',
        fullName: 'Denpok',
        blurb: 'serene mercenary spiritual advisor; dispenses tranquil new-age wisdom while enabling Gavin\'s worst impulses',
    },
    {
        id: 'Hoover',
        fullName: 'Hoover',
        blurb: 'Gavin Belson\'s stone-faced head of security; quietly menacing, unfailingly obedient, speaks rarely and ominously',
    },
    {
        id: 'BigHead',
        fullName: 'Nelson "Big Head" Bighetti',
        blurb: 'amiable, clueless, perpetually baffled; fails upward into absurd success without ever understanding how',
    },
] as const;

/** The id list, in roster order — the round-robin name pool for Silicon Valley mode. */
export const SILICON_VALLEY_IDS: readonly string[] = SILICON_VALLEY_ROSTER.map(p => p.id);

const PERSONA_BY_ID: ReadonlyMap<string, Persona> = new Map(
    SILICON_VALLEY_ROSTER.map(p => [p.id, p]),
);

/**
 * Strip the collision suffixes `getUniqueAgentName` appends (`_1`, `_1_1`, …)
 * to recover the base roster id. `Richard_1_1` → `Richard`.
 */
export function baseIdFromAgentName(agentName: string): string {
    return agentName.replace(/(_\d+)+$/, '');
}

/** The persona for an agent name (suffix-tolerant), or undefined if it is not a roster character. */
export function lookupPersona(agentName: string): Persona | undefined {
    return PERSONA_BY_ID.get(baseIdFromAgentName(agentName));
}

/**
 * The persona soul-line spliced into an agent's prompt. Pure: persona in,
 * prose out. The injection layer owns delimiting and idempotency.
 */
export function renderPersonaSoul(persona: Persona): string {
    return `You are taking on the persona of ${persona.fullName} from HBO's Silicon Valley. Operate exactly as usual — same competence, same tools — but channel their soul: ${persona.blurb}`;
}

/**
 * The active round-robin name pool for a given settings value. Silicon Valley
 * mode is on by default, so only an explicit `false` selects the neutral pool.
 */
export function getAgentNamePool(settings: Pick<VTSettings, 'siliconValleyMode'>): readonly string[] {
    return settings.siliconValleyMode === false ? AGENT_NAMES : SILICON_VALLEY_IDS;
}

/**
 * The next round-robin agent name honouring the mode — the single entry point
 * the spawn pipeline uses so callers never touch the pool directly. Returns a
 * base name; collision resolution is the registry's job (getUniqueAgentName).
 */
export function pickAgentName(settings: Pick<VTSettings, 'siliconValleyMode'>): string {
    return getNextAgentName(getAgentNamePool(settings));
}

const PERSONA_SECTION_HEADER: string = '<silicon_valley_persona>';
const PERSONA_SECTION_FOOTER: string = '</silicon_valley_persona>';

/**
 * Splice a Silicon Valley persona block onto the tail of AGENT_PROMPT — purely
 * additive flavor on top of the normal prompt; competence and tooling untouched.
 * Pure and idempotent (sentinel-guarded). A no-op when the mode is off or the
 * name is not a roster character (neutral pool, or a fork inheriting a
 * non-character id). Lives here, beside the roster, so vt-daemon's spawn
 * pipeline depends on a single graph-model entry point rather than the
 * lookup + render internals.
 */
export function appendPersonaToAgentPrompt(
    envVars: Record<string, string>,
    agentName: string,
    settings: Pick<VTSettings, 'siliconValleyMode'>,
): Record<string, string> {
    if (settings.siliconValleyMode === false) return envVars;

    const persona: Persona | undefined = lookupPersona(agentName);
    if (!persona) return envVars;

    const current: string = envVars.AGENT_PROMPT ?? '';
    if (current.includes(PERSONA_SECTION_HEADER)) return envVars;

    const block: string = `\n\n${PERSONA_SECTION_HEADER}\n${renderPersonaSoul(persona)}\n${PERSONA_SECTION_FOOTER}\n`;
    return {...envVars, AGENT_PROMPT: current + block};
}
