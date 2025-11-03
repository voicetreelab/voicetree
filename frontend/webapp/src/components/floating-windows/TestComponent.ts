/**
 * TestComponent - Vanilla JS test component for floating windows
 * Used in unit and e2e tests
 */

export interface TestComponentOptions {
  container: HTMLElement;
}

export class TestComponent {
  private container: HTMLElement;
  private rootElement: HTMLElement;

  constructor(options: TestComponentOptions) {
    this.container = options.container;
    this.rootElement = this.createUI();
    this.container.appendChild(this.rootElement);
  }

  private createUI(): HTMLElement {
    const root = document.createElement('div');
    root.style.padding = '20px';
    root.style.backgroundColor = 'lightblue';

    const heading = document.createElement('h1');
    heading.textContent = 'Test Component';
    root.appendChild(heading);

    const paragraph = document.createElement('p');
    paragraph.textContent = 'This is a simple test component.';
    root.appendChild(paragraph);

    const button = document.createElement('button');
    button.textContent = 'Test Button';
    root.appendChild(button);

    const textarea = document.createElement('textarea');
    textarea.value = 'Test textarea';
    root.appendChild(textarea);

    return root;
  }

  dispose(): void {
    if (this.rootElement && this.rootElement.parentNode) {
      this.rootElement.parentNode.removeChild(this.rootElement);
    }
  }
}
