// PDF readers are extension pages: runtime messages are broadcast to other readers.
// Only answer page-control messages; the worker owns Notion and capture requests.
const CloseReaderMessaging = {
  pageMessage(message, handlers, reply) {
    if (!['toggle', 'panel', 'screenshot'].includes(message?.type)) return;
    handlers[message.type]?.();
    reply({ enabled: handlers.enabled() });
  },
};
if (typeof module !== 'undefined') module.exports = CloseReaderMessaging;
