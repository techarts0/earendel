// Earendel Behavioral Commands Master Registration Entry
import { globalCommandRegistry } from '../commandRegistry';
import { fileCommands } from './fileCommands';
import { textCommands } from './textCommands';
import { sysCommands } from './sysCommands';
import { archiveCommands } from './archiveCommands';
import { userCommands } from './userCommands';
import { shellControlCommands } from './shellControlCommands';
import { netArchiveCommands } from './netArchiveCommands';
import { aptCommands } from './aptCommands';
import { netCommands } from './netCommands';
import { systemdCommands } from './systemdCommands';
import { netSecurityCommands } from './netSecurityCommands';
import { manCommands } from './manCommands';
import { dockerCommands } from './dockerCommands';
import { geekArtCommands } from './geekArtCommands';
import { netTracerCommands } from './netTracerCommands';
import { pythonCommands } from './pythonCommands';
import { nodeCommands } from './nodeCommands';
import { themeCommands } from './themeCommands';
import { archiveSuiteCommands } from './archiveSuiteCommands';
import { aliasCommands } from './aliasCommands';
import { findSuiteCommands } from './findSuiteCommands';

export function registerAllCommands(): void {
  const allSuites = [
    ...fileCommands,
    ...textCommands,
    ...sysCommands,
    ...archiveCommands,
    ...userCommands,
    ...shellControlCommands,
    ...netArchiveCommands,
    ...aptCommands,
    ...netCommands,
    ...systemdCommands,
    ...netSecurityCommands,
    ...manCommands,
    ...dockerCommands,
    ...geekArtCommands,
    ...netTracerCommands,
    ...pythonCommands,
    ...nodeCommands,
    ...themeCommands,
    ...archiveSuiteCommands,
    ...aliasCommands,
    ...findSuiteCommands,
  ];

  for (const cmd of allSuites) {
    globalCommandRegistry.register(cmd);
  }
}

// Auto register on module load
registerAllCommands();
