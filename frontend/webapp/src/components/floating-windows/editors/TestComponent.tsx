import React from 'react';

export const TestComponent: React.FC = () => {
  return (
    <div style={{ padding: '20px', backgroundColor: 'lightblue' }}>
      <h1>Test Component</h1>
      <p>This is a simple test component.</p>
      <button>Test Button</button>
      <textarea defaultValue="Test textarea" />
    </div>
  );
};