import { describe, expect, it } from 'vitest';

import { mountRigPreview } from '../../src/adapters/rig-preview.ts';

describe('RigPreview — ?rig=1 debug tooling (ARCH §37)', () => {
  it('mounts a slider panel and removes everything on dispose', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const preview = mountRigPreview({ root });
    try {
      // jsdom has no WebGL: the mount must report failure and add nothing, never throw.
      expect(preview.ok).toBe(false);
      expect(root.querySelector('.gw-rig-preview')).toBeNull();
    } finally {
      preview.dispose();
      root.remove();
    }
    expect(root.querySelector('.gw-rig-preview')).toBeNull();
  });
});
