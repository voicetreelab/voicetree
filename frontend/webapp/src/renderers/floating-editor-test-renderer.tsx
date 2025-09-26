import React from 'react';
import ReactDOM from 'react-dom/client';

const TestApp = () => {
  return <h1>Hello World</h1>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TestApp />
  </React.StrictMode>
);
