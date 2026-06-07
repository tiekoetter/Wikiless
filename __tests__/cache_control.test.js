describe('cache_control', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('removeCacheFiles() does nothing when cache control is disabled', () => {
    const rm = jest.fn();
    jest.doMock('fs', () => ({ rm }));
    jest.doMock('../wikiless.config', () => ({ cache_control: false }));

    const cacheControl = require('../src/cache_control');
    cacheControl.removeCacheFiles();

    expect(rm).not.toHaveBeenCalled();
  });

  test('removeCacheFiles() clears cache immediately and schedules cleanup', () => {
    const rm = jest.fn((path, options, callback) => callback());
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.doMock('fs', () => ({ rm }));
    jest.doMock('../wikiless.config', () => ({
      cache_control: true,
      cache_control_interval: 0,
    }));

    const cacheControl = require('../src/cache_control');
    cacheControl.removeCacheFiles();

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(
      './media/wikipedia/',
      { recursive: true, force: true },
      expect.any(Function)
    );

    jest.advanceTimersByTime(1000 * 60 * 60 * 24);
    expect(rm).toHaveBeenCalledTimes(2);
  });
});
