/**
 * Unit tests for DistanceSlider module.
 *
 * Tests the showFloatingSlider function, particularly:
 * - Creating a new slider when none exists
 * - Reusing existing slider when attached to same menu
 * - Destroying and recreating slider when it's stale (orphaned or attached to different menu)
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { showFloatingSlider, destroyFloatingSlider } from './DistanceSlider';

describe('DistanceSlider', () => {
    let menuElement1: HTMLDivElement;
    let menuElement2: HTMLDivElement;
    let anchorElement: HTMLButtonElement;

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

        // Create anchor element (the button to position slider above)
        anchorElement = document.createElement('button');
        anchorElement.id = 'anchor-button';
        document.body.appendChild(anchorElement);
    });

    test('creates new slider when none exists', () => {
        const onDistanceChange = vi.fn();
        const onRun = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // Slider should be appended to menuElement1
        const slider = menuElement1.querySelector('.distance-slider');
        expect(slider).not.toBeNull();
        expect(slider?.parentElement).toBe(menuElement1);
    });

    test('reuses existing slider when same menuElement', () => {
        const onDistanceChange = vi.fn();
        const onRun = vi.fn();

        // First call - creates slider
        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        const slider1 = menuElement1.querySelector('.distance-slider');
        expect(slider1).not.toBeNull();

        // Second call - should reuse same slider
        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // Should still only have one slider
        const sliders = menuElement1.querySelectorAll('.distance-slider');
        expect(sliders.length).toBe(1);
        expect(sliders[0]).toBe(slider1);
    });

    test('destroys stale slider when attached to different menuElement', () => {
        const onDistanceChange = vi.fn();
        const onRun = vi.fn();

        // Create slider attached to menuElement1
        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        const slider1 = menuElement1.querySelector('.distance-slider');
        expect(slider1).not.toBeNull();

        // Now show slider on menuElement2 - should create new slider
        showFloatingSlider({
            menuElement: menuElement2,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // menuElement1 should no longer have the slider (was removed)
        // menuElement2 should have the new slider
        const slider2 = menuElement2.querySelector('.distance-slider');
        expect(slider2).not.toBeNull();
        expect(slider2?.parentElement).toBe(menuElement2);
    });

    test('destroys stale slider when menuElement is removed from DOM (orphaned)', () => {
        const onDistanceChange = vi.fn();
        const onRun = vi.fn();

        // Create slider attached to menuElement1
        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        const slider1 = menuElement1.querySelector('.distance-slider');
        expect(slider1).not.toBeNull();

        // Simulate editor closing - remove menuElement1 from DOM
        // This orphans the slider (isConnected becomes false)
        document.body.removeChild(menuElement1);

        // Now show slider on menuElement2 - should detect orphaned slider and recreate
        showFloatingSlider({
            menuElement: menuElement2,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
            onRun,
        });

        // menuElement2 should have a new slider
        const slider2 = menuElement2.querySelector('.distance-slider');
        expect(slider2).not.toBeNull();
        expect(slider2?.parentElement).toBe(menuElement2);
    });

    test('slider is visible after showFloatingSlider', () => {
        const onDistanceChange = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
        });

        const slider = menuElement1.querySelector('.distance-slider') as HTMLElement;
        expect(slider).not.toBeNull();
        expect(slider.style.display).toBe('flex');
    });

    test('destroyFloatingSlider removes slider from DOM', () => {
        const onDistanceChange = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
        });

        expect(menuElement1.querySelector('.distance-slider')).not.toBeNull();

        destroyFloatingSlider();

        expect(menuElement1.querySelector('.distance-slider')).toBeNull();
    });

    test('slider uses fixed positioning based on anchorElement', () => {
        const onDistanceChange = vi.fn();

        showFloatingSlider({
            menuElement: menuElement1,
            anchorElement,
            currentDistance: 5,
            onDistanceChange,
        });

        const slider = menuElement1.querySelector('.distance-slider') as HTMLElement;
        expect(slider).not.toBeNull();
        expect(slider.style.position).toBe('fixed');
        // Transform should center horizontally and align bottom to top of button
        expect(slider.style.transform).toBe('translate(-50%, -100%)');
    });
});
