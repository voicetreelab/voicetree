/** Shell-quote a single argument (wrap in single quotes, escape existing single quotes) */
export function shellQuote(arg: string): string {
    return "'" + arg.replace(/'/g, "'\\''") + "'";
}
