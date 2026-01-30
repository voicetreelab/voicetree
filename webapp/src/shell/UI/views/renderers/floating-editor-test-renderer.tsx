// Simple vanilla JavaScript test renderer
const rootDiv: HTMLElement | null = document.getElementById('root');
if (rootDiv) {
  const h1: HTMLHeadingElement = document.createElement('h1');
  h1.textContent = 'Editor Test Harness';
  rootDiv.appendChild(h1);
}