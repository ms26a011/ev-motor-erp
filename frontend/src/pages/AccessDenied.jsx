import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

function AccessDenied() {
  return (
    <section className="access-denied">
      <ShieldAlert size={34} />
      <h2>Access Denied</h2>
      <p>Your employee account is not authorised for this ERP area.</p>
      <Link className="btn primary" to="/">Back to Dashboard</Link>
    </section>
  );
}

export default AccessDenied;
