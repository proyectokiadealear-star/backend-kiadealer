import { BeforeAll, Before } from '@cucumber/cucumber';
import { KiaDealerWorld } from './world';

BeforeAll(async () => {
  await KiaDealerWorld.assertEmulatorsRunning();
});

// Aísla cada escenario: sin esto, el escenario N podría heredar datos que
// dejó el escenario N-1, produciendo falsos positivos o negativos.
Before(async function (this: KiaDealerWorld) {
  await this.clearFirestore();
  await this.clearAuthUsers();
});
