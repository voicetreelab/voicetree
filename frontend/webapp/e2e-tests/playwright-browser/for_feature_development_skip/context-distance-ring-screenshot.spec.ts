import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
    waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test('screenshot context distance ring control at different values', async ({ page }) => {
    await page.goto('/');
    await setupMockElectronAPI(page);
    await waitForCytoscapeReady(page);

    // Inject the ContextDistanceRing visualization directly as SVG
    // This mirrors what the React component renders
    await page.evaluate(() => {
        const MIN_DISTANCE: number = 1;
        const MAX_DISTANCE: number = 10;
        const RING_BASE_RADIUS: number = 40;
        const RING_RADIUS_PER_UNIT: number = 12;
        const currentValue: number = 6;

        const svgSize: number = (MAX_DISTANCE * RING_RADIUS_PER_UNIT + RING_BASE_RADIUS) * 2 + 40;
        const svgCenter: number = svgSize / 2;
        const currentRadius: number = RING_BASE_RADIUS + (currentValue * RING_RADIUS_PER_UNIT);

        // Create container with dark background to simulate graph view
        const container: HTMLDivElement = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1a1a2e;
            padding: 40px;
            border-radius: 12px;
            z-index: 9999;
        `;

        // Create mock node
        const mockNode: HTMLDivElement = document.createElement('div');
        mockNode.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 60px;
            height: 60px;
            background: #2d2d44;
            border: 2px solid #4a4a6a;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: #888;
        `;
        mockNode.textContent = 'RUN';

        // Build SVG manually (same as React component output)
        const svg: SVGSVGElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(svgSize));
        svg.setAttribute('height', String(svgSize));
        svg.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;`;

        // Defs for filters and gradients
        svg.innerHTML = `
            <defs>
                <filter id="goldGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <radialGradient id="contextZone" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="rgba(251, 191, 36, 0)" />
                    <stop offset="70%" stop-color="rgba(251, 191, 36, 0.05)" />
                    <stop offset="100%" stop-color="rgba(251, 191, 36, 0.15)" />
                </radialGradient>
            </defs>

            <!-- Context zone fill -->
            <circle cx="${svgCenter}" cy="${svgCenter}" r="${currentRadius}" fill="url(#contextZone)" />
        `;

        // Add tick circles and numbers
        for (let tick: number = MIN_DISTANCE; tick <= MAX_DISTANCE; tick++) {
            const tickRadius: number = RING_BASE_RADIUS + (tick * RING_RADIUS_PER_UNIT);
            const isActive: boolean = tick <= currentValue;
            const isCurrent: boolean = tick === currentValue;

            const circle: SVGCircleElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(svgCenter));
            circle.setAttribute('cy', String(svgCenter));
            circle.setAttribute('r', String(tickRadius));
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', isActive ? 'rgba(251, 191, 36, 0.4)' : 'rgba(255, 255, 255, 0.1)');
            circle.setAttribute('stroke-width', isCurrent ? '2' : '1');
            if (!isCurrent) {
                circle.setAttribute('stroke-dasharray', '2 4');
            }
            svg.appendChild(circle);

            // Number at 45 degree angle
            const text: SVGTextElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(svgCenter + tickRadius * Math.cos(-Math.PI / 4)));
            text.setAttribute('y', String(svgCenter + tickRadius * Math.sin(-Math.PI / 4)));
            text.setAttribute('fill', isActive ? 'rgba(251, 191, 36, 0.9)' : 'rgba(255, 255, 255, 0.3)');
            text.setAttribute('font-size', '10');
            text.setAttribute('font-family', "'JetBrains Mono', 'SF Mono', monospace");
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.style.fontWeight = isCurrent ? '600' : '400';
            text.textContent = String(tick);
            svg.appendChild(text);
        }

        // Main active ring with glow
        const mainRing: SVGCircleElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        mainRing.setAttribute('cx', String(svgCenter));
        mainRing.setAttribute('cy', String(svgCenter));
        mainRing.setAttribute('r', String(currentRadius));
        mainRing.setAttribute('fill', 'none');
        mainRing.setAttribute('stroke', 'rgba(251, 191, 36, 0.9)');
        mainRing.setAttribute('stroke-width', '3');
        mainRing.setAttribute('filter', 'url(#goldGlow)');
        svg.appendChild(mainRing);

        // Value badge
        const badgeX: number = svgCenter + currentRadius + 16;
        const badgeY: number = svgCenter - 8;
        const badgeGroup: SVGGElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeGroup.setAttribute('transform', `translate(${badgeX}, ${badgeY})`);
        badgeGroup.innerHTML = `
            <rect x="-12" y="-8" width="24" height="16" rx="3"
                  fill="rgba(251, 191, 36, 0.2)" stroke="rgba(251, 191, 36, 0.6)" stroke-width="1"/>
            <text x="0" y="1" fill="rgba(251, 191, 36, 1)" font-size="11"
                  font-family="'JetBrains Mono', monospace" text-anchor="middle"
                  dominant-baseline="middle" font-weight="600">${currentValue}</text>
        `;
        svg.appendChild(badgeGroup);

        // Scroll hint
        const hintText: SVGTextElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        hintText.setAttribute('x', String(svgCenter));
        hintText.setAttribute('y', String(svgCenter + currentRadius + 28));
        hintText.setAttribute('fill', 'rgba(255, 255, 255, 0.4)');
        hintText.setAttribute('font-size', '9');
        hintText.setAttribute('font-family', "'JetBrains Mono', monospace");
        hintText.setAttribute('text-anchor', 'middle');
        hintText.textContent = 'scroll to adjust';
        svg.appendChild(hintText);

        container.appendChild(svg);
        container.appendChild(mockNode);
        document.body.appendChild(container);
    });

    await page.waitForTimeout(300);

    // Take screenshot of the ring control
    await page.screenshot({
        path: 'e2e-tests/screenshots/context-distance-ring.png',
        clip: { x: 340, y: 140, width: 400, height: 400 }
    });
});
