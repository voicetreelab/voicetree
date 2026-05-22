import { platformFromRuntimePlatform, type ShortcutPlatform } from '@vt/graph-model/utils';

type NavigatorWithUserAgentData = Navigator & {
    readonly userAgentData?: {
        readonly platform?: string;
    };
};

export function getShortcutPlatform(
    navigatorRef: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): ShortcutPlatform {
    const browserNavigator: NavigatorWithUserAgentData | undefined = navigatorRef as NavigatorWithUserAgentData | undefined;
    const browserPlatform = [
        browserNavigator?.userAgentData?.platform,
        browserNavigator?.platform,
        browserNavigator?.userAgent,
    ].filter(Boolean).join(' ');

    return platformFromRuntimePlatform(browserPlatform);
}
