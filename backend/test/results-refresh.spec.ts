import { ResultsService } from '../src/results/results.service';

it('discards an in-flight results snapshot when reset invalidates it', async () => {
  const listeners: Record<string, () => void> = {};
  const bus = { on: (event: string, callback: () => void) => { listeners[event] = callback; } };
  const results = new ResultsService({} as any, bus as any, {} as any);
  let resolveOld!: (value: any) => void;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const current = { totals: { votes: 0 }, generated_at: 'new' };
  const compute = jest.spyOn(results as any, 'compute').mockReturnValueOnce(old).mockResolvedValue(current);
  try {
    const pending = results.snapshot();
    listeners['results-changed']();
    resolveOld({ totals: { votes: 10 }, generated_at: 'old' });
    expect(await pending).toEqual(current);
    expect(await results.snapshot()).toEqual(current);
    expect(compute).toHaveBeenCalledTimes(2);
  } finally { results.onModuleDestroy(); }
});
