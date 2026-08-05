const browserOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4300';
const isLocalAngularDev = typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port === '4200';

export const environment = {
  production: false,
  apiUrl: isLocalAngularDev ? 'http://localhost:4300' : browserOrigin,
};
