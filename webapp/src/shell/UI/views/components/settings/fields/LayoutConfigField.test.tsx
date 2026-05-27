// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import { LayoutConfigField } from './LayoutConfigField';

function renderLayoutConfigField(value: string): RenderResult & { readonly onChange: Mock } {
  const onChange: Mock = vi.fn();
  return {
    ...render(<LayoutConfigField label="Layout Config" value={value} onChange={onChange} />),
    onChange,
  };
}

function expectNextConfigEngine(onChange: Mock, engine: string): void {
  expect(onChange).toHaveBeenCalledTimes(1);
  const updated: unknown = onChange.mock.calls[0]?.[0];
  expect(typeof updated).toBe('string');
  expect(JSON.parse(updated as string)).toMatchObject({
    engine,
    nodeSpacing: 120,
  });
}

describe('LayoutConfigField', () => {
  it.each([
    ['ForceAtlas2', 'forceatlas2'],
    ['ComboCombined', 'combocombined'],
    ['Mindmap', 'mindmap'],
    ['WebCoLA', 'webcola'],
  ])('selects %s and preserves the existing JSON config', (label, engine) => {
    const initialEngine = engine === 'forceatlas2' ? 'webcola' : 'forceatlas2';
    const { onChange } = renderLayoutConfigField(
      JSON.stringify({ engine: initialEngine, nodeSpacing: 120, edgeLength: 350 }, null, 2)
    );

    fireEvent.click(screen.getByLabelText(label));

    expectNextConfigEngine(onChange, engine);
  });

  it('treats legacy cola config as the WebCoLA radio option', () => {
    renderLayoutConfigField(JSON.stringify({ engine: 'cola', nodeSpacing: 120 }, null, 2));

    const webcolaRadio = screen.getByLabelText('WebCoLA') as HTMLInputElement;

    expect(webcolaRadio.checked).toBe(true);
  });

  it('passes raw JSON text edits through to settings persistence', () => {
    const { container, onChange } = renderLayoutConfigField(
      JSON.stringify({ engine: 'forceatlas2', nodeSpacing: 120 }, null, 2)
    );
    const textArea: HTMLTextAreaElement | null = container.querySelector('textarea');
    const nextValue = JSON.stringify({ engine: 'mindmap', nodeSpacing: 160 }, null, 2);

    expect(textArea).not.toBeNull();
    fireEvent.change(textArea!, { target: { value: nextValue } });

    expect(onChange).toHaveBeenCalledWith(nextValue);
  });
});
