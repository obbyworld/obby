// The container's /config.js runs before this module and holds the network
// settings of this deployment; anything it leaves out keeps its build value.
const scope = globalThis as { __OBBY_CONFIG__?: Record<string, unknown> };
scope.__OBBY_CONFIG__ = { ...__BUILD_CONFIG__, ...scope.__OBBY_CONFIG__ };
