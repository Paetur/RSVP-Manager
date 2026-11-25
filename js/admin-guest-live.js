// Guest activity signals only invalidate the Overview projection.
(function () {
  "use strict";
  const topics = new Set(["rsvp:guest-overview:invites", "rsvp:guest-overview:food"]);
  const unavailable = new Set(["PGRST202", "42883", "PT401", "42501", "AUTH_SESSION_MISSING"]);

  function create({ getClient, getContext, readSnapshot, onSnapshot }) {
    let state = null;
    const context = () => document.hidden ? null : getContext();
    const active = run => run === state && run.context === context() && !run.disabled;

    function closeChannels(run) {
      for (const { channel } of run.channels.values()) run.client.removeChannel(channel);
      run.channels.clear();
    }

    function request(run) {
      if (!active(run)) return;
      run.dirty = true;
      if (run.pending || run.timer !== null) return;
      run.timer = setTimeout(() => {
        run.timer = null;
        update(run);
      }, 200);
    }

    function subscribe(run, allowed) {
      for (const [topic, { channel }] of run.channels) {
        if (allowed.has(topic)) continue;
        run.channels.delete(topic);
        run.client.removeChannel(channel);
      }
      if (typeof run.client?.channel !== "function") return;
      for (const topic of allowed) {
        if (run.channels.has(topic)) continue;
        const channel = run.client.channel(topic, { config: { private: true } });
        const record = { channel, ready: false };
        run.channels.set(topic, record);
        channel.on("broadcast", { event: "changed" }, () => request(run));
        channel.subscribe(status => {
          if (!active(run) || run.channels.get(topic) !== record) return;
          record.ready = status === "SUBSCRIBED";
          if (status === "CLOSED") run.channels.delete(topic);
          // Catch up on anything committed before the subscription was ready.
          if (record.ready) request(run);
        });
      }
    }

    async function update(run) {
      if (!active(run)) return;
      run.pending = true;
      run.dirty = false;
      try {
        const { data, error } = await readSnapshot();
        if (!active(run)) return;
        if (unavailable.has(error?.code) || (!error && typeof data?.realtime !== "boolean")) {
          run.disabled = true;
          clearInterval(run.fallback);
          closeChannels(run);
          return;
        }
        run.failed = Boolean(error);
        if (error) return;
        onSnapshot(data);
        run.lastRead = Date.now();
        const allowed = new Set(Array.isArray(data.topics) ? data.topics.filter(topic => topics.has(topic)) : []);
        run.topicCount = allowed.size;
        subscribe(run, data.realtime ? allowed : new Set());
      } catch (_) {
        // A quiet retry keeps Overview usable when the connection recovers.
        run.failed = true;
      } finally {
        run.pending = false;
        if (run.dirty) request(run);
      }
    }

    function sync() {
      const current = context();
      if (state && current === state.context) return;
      if (state) {
        const previous = state;
        state = null;
        clearTimeout(previous.timer);
        clearInterval(previous.fallback);
        closeChannels(previous);
      }
      if (current === null) return;
      const run = {
        context: current, client: getClient(), channels: new Map(), timer: null,
        disabled: false, pending: false, dirty: false, failed: true, topicCount: 0, lastRead: 0,
      };
      state = run;
      run.fallback = setInterval(() => {
        const connected = [...run.channels.values()].filter(channel => channel.ready).length;
        // Reconcile occasionally even while connected, since broadcasts can be missed.
        if (run.failed || connected < run.topicCount || (run.topicCount && Date.now() - run.lastRead >= 60000)) request(run);
      }, 15000);
      request(run);
    }

    function resume() {
      sync();
      if (state) request(state);
    }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return { sync };
  }

  window.RSVP_ADMIN_GUEST_LIVE = Object.freeze({ create });
})();
