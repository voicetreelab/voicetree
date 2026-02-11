/**
 * Unit tests for DistanceSlider module.
 *
 * Tests the showFloatingSlider function, particularly:
 * - Creating a new slider when none exists
 * - Reusing existing slider (appended to document.body for fixed positioning)
 * - Destroying slider via destroyFloatingSlider
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { showFloatingSlider, destroyFloatingSlider } from './DistanceSlider';

describe('DistanceSlider', () => {
    let menuElement1: HTMLDivElement;
    let menuElement2: HTMLDivElement;

    beforeEach(() => {
        // Clean up any existing slider before each test
        destroyFloatingSlider();

        // Create fresh menu elements for each test
        menuElement1 = document.createElement('div');
        menuElement1.id = 'menu-1';
        document.body.appendChild(menuElement1);

        menuElement2 = document.createElement('div');
        menuElement2.id = 'menu-2';
        document.body.appendChild(menuElement2);
    });

    test('creates new slider when none exists', () => {
        const onDistanceChange: (n: number) => void = vi.fn();
        const onRun: () => void = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // Slider is appended to document.body for fixed positioning
        const slider: Element | null = document.body.querySelector('.distance-slider');
        expect(slider).not.toBeNull();
        expect(slider?.parentElement).toBe(document.body);
    });

    test('reuses existing slider when same menuElement', () => {
        const onDistanceChange: (n: number) => void = vi.fn();
        const onRun: () => void = vi.fn();

        // First call - creates slider
        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        const slider1: Element | null = document.body.querySelector('.distance-slider');
        expect(slider1).not.toBeNull();

        // Second call - should reuse same slider
        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // Should still only have one slider on document.body
        const sliders: NodeListOf<Element> = document.body.querySelectorAll('.distance-slider');
        expect(sliders.length).toBe(1);
        expect(sliders[0]).toBe(slider1);
    });

    test('reuses slider when switching to different menuElement', () => {
        const onDistanceChange: (n: number) => void = vi.fn();
        const onRun: () => void = vi.fn();

        // Create slider positioned relative to menuElement1
        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        const slider1: Element | null = document.body.querySelector('.distance-slider');
        expect(slider1).not.toBeNull();

        // Show slider for menuElement2 - reuses the same slider (repositioned)
        showFloatingSlider({
            menuElement: menuElement2,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // Same slider instance should still be on document.body
        const slider2: Element | null = document.body.querySelector('.distance-slider');
        expect(slider2).not.toBeNull();
        expect(slider2).toBe(slider1);
    });

    test('slider persists on body even when menuElement is removed from DOM', () => {
        const onDistanceChange: (n: number) => void = vi.fn();
        const onRun: () => void = vi.fn();

        // Create slider positioned relative to menuElement1
        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        const slider1: Element | null = document.body.querySelector('.distance-slider');
        expect(slider1).not.toBeNull();

        // Simulate editor closing - remove menuElement1 from DOM
        document.body.removeChild(menuElement1);

        // Show slider for menuElement2 - reuses the same slider
        showFloatingSlider({
            menuElement: menuElement2,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // Slider should still be on document.body
        const slider2: Element | null = document.body.querySelector('.distance-slider');
        expect(slider2).not.toBeNull();
        expect(slider2?.parentElement).toBe(document.body);
    });

    test('slider is visible after showFloatingSlider', () => {
        const onDistanceChange: (n: number) => void = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
        });

        const slider: HTMLElement = document.body.querySelector('.distance-slider') as HTMLElement;
        expect(slider).not.toBeNull();
        expect(slider.style.display).toBe('flex');
    });

    test('destroyFloatingSlider removes slider from DOM', () => {
        const onDistanceChange: (n: number) => void = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
        });

        expect(document.body.querySelector('.distance-slider')).not.toBeNull();

        destroyFloatingSlider();

        expect(document.body.querySelector('.distance-slider')).toBeNull();
    });

    test('slider is appended to document.body (not menuElement) for fixed positioning', () => {
        const onDistanceChange: (n: number) => void = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            currentDistance: 5,
            onDistanceChange,
        });

        const slider: HTMLElement = document.body.querySelector('.distance-slider') as HTMLElement;
        expect(slider).not.toBeNull();
        // Slider is a direct child of body (not menuElement) to escape stacking context
        expect(slider.parentElement).toBe(document.body);
        // Position is set via cssText (position: fixed, transform) which JSDOM doesn't fully parse,
        // but the left/top values are set individually by showFloatingSlider
        expect(slider.style.display).toBe('flex');
    });
});
