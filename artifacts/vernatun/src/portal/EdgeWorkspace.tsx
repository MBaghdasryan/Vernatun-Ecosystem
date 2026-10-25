import EdgeManagement from './edge-management/EdgeManagement';
import type { Language } from './i18n';
import type { RoleContext } from './types';

// Platform (/console/edge) and organization (/os/edge) share one implementation;
// the mode is derived from the active role context inside EdgeManagement.
export default function EdgeWorkspace({ c, language }: { c: RoleContext; language: Language }) {
  return <EdgeManagement c={c} language={language} />;
}
