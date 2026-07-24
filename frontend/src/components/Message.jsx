import React from 'react';

function Message({ type = 'success', children }) {
  if (!children) return null;
  return <div className={`message ${type}`}>{children}</div>;
}

export default Message;
