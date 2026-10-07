export const systemPermissions=[
 'system.read','system.health.read','sessions.read','sessions.revoke','backups.read','backups.create','backups.download','backups.restore','backups.delete','backups.policies.manage',
 'logs.read','logs.export','logs.manage','cache.read','cache.clear','api.read','api.keys.manage','api.clients.manage',
 'integrations.read','integrations.manage','integrations.test','plugins.read','plugins.manage',
 'updates.read','updates.upload','updates.install','updates.rollback','jobs.read','jobs.manage','environment.read',
] as const;
