// Saved links.
//
// A link is a URL plus what the page said about itself when it was added. The
// server reads the page once, on add; the card renders from that snapshot, so
// opening this section makes no request to any of the sites in it.

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { requestJson, can } = global.AppApi;
  const { setMeta, syncBodyLock } = global.AppShell;
  const { notify, setStatus, requestConfirmation } = global.AppNotify;
  const { enterModalLayer, exitModalLayer } = global.AppModal;

  function linkHost(link) {
    try {
      return new URL(link.url).hostname.replace(/^www\./, "");
    } catch {
      return link.url;
    }
  }

  function linkGroupsOf(link) {
    return Array.isArray(link.groups) ? link.groups : [];
  }

  function inSelectedGroup(link) {
    if (state.linkGroupFilter === null) {
      return true;
    }

    const groups = linkGroupsOf(link);

    // "" is the Ungrouped chip, which is the one filter you cannot express as a
    // group name and the one you need most while filing a backlog.
    if (state.linkGroupFilter === "") {
      return groups.length === 0;
    }

    const wanted = state.linkGroupFilter.toLowerCase();
    return groups.some((name) => name.toLowerCase() === wanted);
  }

  function matchingLinks() {
    const needle = state.linkFilter.trim().toLowerCase();

    return state.links.filter((link) => {
      if (!inSelectedGroup(link)) {
        return false;
      }

      if (!needle) {
        return true;
      }

      // The group names are searched too, so typing a group name finds its links
      // whether or not the chip is selected.
      return [link.title, link.description, link.note, link.url, link.siteName, ...linkGroupsOf(link)]
        .some((field) => String(field || "").toLowerCase().includes(needle));
    });
  }

  // Derived here rather than trusted from the server, so the chip bar is correct
  // the instant a card changes rather than after the next round trip.
  function groupCounts() {
    const counts = new Map();

    for (const link of state.links) {
      for (const name of linkGroupsOf(link)) {
        const key = name.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { name, count: 1 });
        }
      }
    }

    return [...counts.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }

  function selectLinkGroup(value) {
    // Clicking the selected chip clears it, so the filter is its own way out.
    state.linkGroupFilter = state.linkGroupFilter === value ? null : value;
    renderLinks();
  }

  async function setLinkGroups(id, groups) {
    const link = state.links.find((entry) => entry.id === id);
    if (!link) {
      return;
    }

    const before = linkGroupsOf(link);

    try {
      const payload = await requestJson(`/api/links/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ groups })
      });

      state.links = state.links.map((entry) => (entry.id === id ? payload.link : entry));
      renderLinks();
    } catch (error) {
      // Put the card back the way it was: the optimistic render already happened
      // in the drag case, and a card silently showing a group the server refused
      // is worse than an error.
      link.groups = before;
      renderLinks();
      notify(error.message, "error");
    }
  }

  function renderGroupChips() {
    if (!elements.linksGroups) {
      return;
    }

    const counts = groupCounts();
    const ungrouped = state.links.filter((link) => linkGroupsOf(link).length === 0).length;

    elements.linksGroups.innerHTML = "";

    // No chip bar for a library with no groups in it: an "All (3)" chip on its
    // own is a control that does nothing.
    if (counts.length === 0) {
      return;
    }

    const chip = (label, value, count) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = state.linkGroupFilter === value ? "group-chip active" : "group-chip";
      button.setAttribute("aria-pressed", String(state.linkGroupFilter === value));

      // "All" and "Ungrouped" are not group names, and both would otherwise sit
      // in data-group as an empty string — indistinguishable from each other and
      // from a group that happens to be unnamed.
      if (value === null) {
        button.dataset.groupAll = "";
      } else if (value === "") {
        button.dataset.groupNone = "";
      } else {
        button.dataset.group = value;
      }

      const text = document.createElement("span");
      text.textContent = label;
      button.appendChild(text);

      if (typeof count === "number") {
        const badge = document.createElement("span");
        badge.className = "group-chip-count";
        badge.textContent = String(count);
        button.appendChild(badge);
      }

      button.addEventListener("click", () => selectLinkGroup(value));

      // Dropping a card on a chip files it there — the quickest way to group a
      // backlog, since it needs no dialog and no typing.
      if (value !== null && value !== "" && can("doc:write")) {
        button.addEventListener("dragover", (event) => {
          if (!state.linkDragId) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          button.classList.add("drop-target");
        });

        button.addEventListener("dragleave", () => button.classList.remove("drop-target"));

        button.addEventListener("drop", (event) => {
          event.preventDefault();
          button.classList.remove("drop-target");

          const id = state.linkDragId;
          if (!id) {
            return;
          }

          const link = state.links.find((entry) => entry.id === id);
          const existing = link ? linkGroupsOf(link) : [];
          if (existing.some((name) => name.toLowerCase() === value.toLowerCase())) {
            notify(`Already in "${value}".`, "neutral");
            return;
          }

          void setLinkGroups(id, [...existing, value]);
        });
      }

      elements.linksGroups.appendChild(button);
      return button;
    };

    chip("All", null, state.links.length);
    for (const group of counts) {
      chip(group.name, group.name, group.count);
    }
    if (ungrouped > 0) {
      chip("Ungrouped", "", ungrouped);
    }
  }

  function syncGroupDatalist() {
    if (!elements.linkGroupOptions) {
      return;
    }

    elements.linkGroupOptions.innerHTML = "";
    for (const group of groupCounts()) {
      const option = document.createElement("option");
      option.value = group.name;
      elements.linkGroupOptions.appendChild(option);
    }
  }

  // Filing a card without leaving the grid: the chip row becomes a text field
  // holding the current groups, Enter saves, Escape puts it back.
  function beginGroupEdit(card, link) {
    if (card.querySelector(".link-card-group-edit")) {
      return;
    }

    const row = card.querySelector(".link-card-groups");
    const editor = document.createElement("div");
    editor.className = "link-card-group-edit";

    const input = document.createElement("input");
    input.type = "text";
    input.name = "link-groups";
    input.value = linkGroupsOf(link).join(", ");
    input.setAttribute("aria-label", `Groups for ${link.title || link.url}`);
    input.placeholder = "osu, APIs";
    input.setAttribute("list", "linkGroupOptions");
    editor.appendChild(input);

    let settled = false;
    const finish = (save) => {
      if (settled) {
        return;
      }
      settled = true;

      if (save) {
        void setLinkGroups(link.id, input.value);
      } else {
        renderLinks();
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });

    input.addEventListener("blur", () => finish(true));

    if (row) {
      row.replaceWith(editor);
    } else {
      card.appendChild(editor);
    }

    input.focus();
    input.select();
  }

  /* The site's own icon, or a letter standing in for it.
   *
   * The bytes came with the link and are drawn from disk, so this never asks the
   * network — see lib/link-preview.js for why the server fetches them instead of
   * the browser. A site whose icon could not be read still needs something in the
   * slot, or a grid of cards is a ragged left edge; the first letter of the host
   * is what it knows.
   */
  function linkIconNode(link) {
    const host = linkHost(link);

    if (link.icon) {
      const image = document.createElement("img");
      image.className = "link-icon";
      image.src = link.icon;
      image.alt = "";
      image.width = 18;
      image.height = 18;
      image.loading = "lazy";
      // A stored icon can still fail to decode — a truncated file, a format this
      // browser does not read. The letter takes over rather than leaving the
      // broken-image glyph.
      image.addEventListener("error", () => {
        image.replaceWith(linkMonogram(host));
      }, { once: true });
      return image;
    }

    return linkMonogram(host);
  }

  function linkMonogram(host) {
    const mark = document.createElement("span");
    mark.className = "link-icon link-icon-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = (host.match(/[a-z0-9]/i) || ["?"])[0].toUpperCase();
    return mark;
  }

  function renderLinkCard(link) {
    const card = document.createElement("article");
    card.className = "link-card";
    card.dataset.id = link.id;

    const head = document.createElement("div");
    head.className = "link-card-head";
    head.appendChild(linkIconNode(link));

    const title = document.createElement("h3");
    title.className = "link-card-title";

    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    // noopener stops the opened page reaching back through window.opener;
    // noreferrer also keeps this app's URL out of the other site's logs. Both
    // matter more here than usual, because these are addresses someone typed.
    anchor.rel = "noopener noreferrer";
    anchor.setAttribute("referrerpolicy", "no-referrer");
    anchor.textContent = link.title || linkHost(link);
    title.appendChild(anchor);
    head.appendChild(title);
    card.appendChild(head);

    if (link.description) {
      const description = document.createElement("p");
      description.className = "link-card-desc";
      description.textContent = link.description;
      card.appendChild(description);
    }

    if (link.note) {
      const note = document.createElement("p");
      note.className = "link-card-note";
      note.textContent = link.note;
      card.appendChild(note);
    }

    const groups = linkGroupsOf(link);
    if (groups.length > 0) {
      const row = document.createElement("div");
      row.className = "link-card-groups";

      for (const name of groups) {
        const groupChip = document.createElement("button");
        groupChip.type = "button";
        groupChip.className = "link-card-group";
        groupChip.textContent = name;
        groupChip.title = `Show only "${name}"`;
        groupChip.addEventListener("click", () => selectLinkGroup(name));
        row.appendChild(groupChip);
      }

      card.appendChild(row);
    }

    const foot = document.createElement("div");
    foot.className = "link-card-foot";

    const host = document.createElement("span");
    host.className = "link-card-host";
    host.textContent = linkHost(link);
    host.title = link.url;
    foot.appendChild(host);

    // A page that could not be read is still a link worth keeping, so it is saved
    // either way — but the card should not pretend the description is missing
    // because the site has none.
    if (!link.fetched) {
      const warn = document.createElement("span");
      warn.className = "link-card-warn";
      warn.title = link.fetchError || "The page could not be read.";
      warn.innerHTML = '<i class="ph ph-warning-circle" aria-hidden="true"></i>';
      foot.appendChild(warn);
    }

    if (can("doc:write")) {
      const actions = document.createElement("div");
      actions.className = "link-card-actions";

      const group = document.createElement("button");
      group.type = "button";
      group.className = "icon-btn icon-btn-sm";
      group.title = "Edit groups";
      group.setAttribute("aria-label", `Edit groups for ${link.title || link.url}`);
      group.innerHTML = '<i class="ph ph-tag" aria-hidden="true"></i>';
      group.addEventListener("click", () => beginGroupEdit(card, link));
      actions.appendChild(group);

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "icon-btn icon-btn-sm";
      refresh.title = "Re-read this page";
      refresh.setAttribute("aria-label", `Re-read ${link.title || link.url}`);
      refresh.innerHTML = '<i class="ph ph-arrow-clockwise" aria-hidden="true"></i>';
      refresh.addEventListener("click", () => void refreshLink(link.id));
      actions.appendChild(refresh);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn icon-btn-sm danger";
      remove.title = "Remove this link";
      remove.setAttribute("aria-label", `Remove ${link.title || link.url}`);
      remove.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i>';
      remove.addEventListener("click", () => void removeLink(link.id));
      actions.appendChild(remove);

      foot.appendChild(actions);
    }

    card.appendChild(foot);

    // Dragging a card onto a group chip files it there. Only worth offering when
    // there is a chip to drop it on and the account may change anything.
    if (can("doc:write")) {
      card.draggable = true;

      card.addEventListener("dragstart", (event) => {
        state.linkDragId = link.id;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "copy";
        // Some browsers refuse to start a drag with nothing on the transfer.
        event.dataTransfer.setData("text/plain", link.url);
      });

      card.addEventListener("dragend", () => {
        state.linkDragId = null;
        card.classList.remove("dragging");
      });
    }

    return card;
  }

  /* The links pane while its one request is in the air.
   *
   * Written into the empty state rather than as a pane of its own: "no links
   * yet" and "not loaded yet" occupy the same space and must never both be on
   * screen, which two elements would eventually manage.
   */
  function showLinksLoading() {
    if (!elements.linksGrid) {
      return;
    }

    elements.linksGrid.innerHTML = "";
    elements.linksEmpty.hidden = false;
    elements.linksEmpty.classList.add("is-loading");
    elements.linksEmpty.querySelector("i").className = "ph ph-circle-notch";
    elements.linksEmpty.querySelector("h3").textContent = "Loading links";
    elements.linksEmpty.querySelector("p").textContent = "Fetching the pages you have saved.";
    elements.linksCount.textContent = "";
    setMeta("Loading links...");
  }

  function renderLinks() {
    if (!elements.linksGrid) {
      return;
    }

    // Whatever the answer turns out to be, the wait is over.
    elements.linksEmpty.classList.remove("is-loading");
    elements.linksEmpty.querySelector("i").className = "ph ph-link-simple";

    const visible = matchingLinks();

    elements.linksGrid.innerHTML = "";
    for (const link of visible) {
      elements.linksGrid.appendChild(renderLinkCard(link));
    }

    elements.linksEmpty.hidden = visible.length > 0;
    if (visible.length === 0 && state.linkFilter.trim()) {
      elements.linksEmpty.querySelector("h3").textContent = "Nothing matches";
      elements.linksEmpty.querySelector("p").textContent =
        `No saved link mentions "${state.linkFilter.trim()}".`;
    } else if (visible.length === 0 && state.linkGroupFilter) {
      elements.linksEmpty.querySelector("h3").textContent = "This group is empty";
      elements.linksEmpty.querySelector("p").textContent =
        `Nothing is filed under "${state.linkGroupFilter}" any more.`;
    } else if (visible.length === 0 && state.linkGroupFilter === "") {
      elements.linksEmpty.querySelector("h3").textContent = "Everything is filed";
      elements.linksEmpty.querySelector("p").textContent = "No link is outside a group.";
    } else if (visible.length === 0) {
      elements.linksEmpty.querySelector("h3").textContent = "No links yet";
      elements.linksEmpty.querySelector("p").textContent =
        "Paste the address of a docs site and it will be saved with the title and description the page gives for itself.";
    }

    const tally = state.links.length === visible.length
      ? `${state.links.length} link${state.links.length === 1 ? "" : "s"}`
      : `${visible.length} of ${state.links.length}`;

    elements.linksCount.textContent = tally;

    // The sidebar is showing these same links, so its line under the title has
    // to count them rather than leaving a document tally under a list of URLs.
    if (state.viewMode === "links") {
      setMeta(tally);
    }

    renderGroupChips();
    syncGroupDatalist();
    renderLinkSidebar(visible);
  }

  // The sidebar keeps working in this mode: the same list, as rows, so the tree
  // pane is not simply blank while the cards are on screen.
  function renderLinkSidebar(visible) {
    if (state.viewMode !== "links" || !elements.docList) {
      return;
    }

    elements.docList.innerHTML = "";

    for (const link of visible) {
      const row = document.createElement("div");
      row.className = "tree-row tree-row-link";

      const anchor = document.createElement("a");
      anchor.className = "tree-row-btn";
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.setAttribute("referrerpolicy", "no-referrer");
      anchor.title = link.url;
      anchor.appendChild(linkIconNode(link));

      const label = document.createElement("span");
      label.textContent = link.title || linkHost(link);
      anchor.appendChild(label);

      row.appendChild(anchor);
      elements.docList.appendChild(row);
    }
  }

  async function refreshLinks() {
    const payload = await requestJson("/api/links");
    state.links = Array.isArray(payload.links) ? payload.links : [];
    state.linkGroups = Array.isArray(payload.groups) ? payload.groups : [];
    state.linksLoaded = true;

    // A chip that no longer exists must not stay selected, or the grid is empty
    // with no way to see why.
    if (state.linkGroupFilter && !state.links.some((link) =>
      (link.groups || []).some((name) => name.toLowerCase() === state.linkGroupFilter.toLowerCase()))) {
      state.linkGroupFilter = null;
    }

    renderLinks();

    // Anything saved before the icons existed has never had one fetched. Go and
    // get those once, in the background, rather than leaving a grid of letters
    // and a button nobody has a reason to look for. Every answer is written back
    // — including "this site has none" — so it happens once and never again.
    if (can("doc:write") && linksNeedingIcons().length > 0) {
      void backfillLinkIcons();
    }
  }

  function openLinkModal() {
    if (!can("doc:write")) {
      return;
    }

    state.linkModalOpen = true;
    elements.linkUrlInput.value = "";
    elements.linkNoteInput.value = "";
    // Adding while a group is selected almost always means "into this group".
    elements.linkGroupsInput.value = state.linkGroupFilter || "";
    syncGroupDatalist();
    elements.linkError.hidden = true;
    elements.linkError.textContent = "";
    elements.linkModal.classList.add("open");
    elements.linkModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.linkModal);
    syncBodyLock();
    elements.linkUrlInput.focus();
  }

  function closeLinkModal() {
    state.linkModalOpen = false;
    elements.linkModal.classList.remove("open");
    elements.linkModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.linkModal);
    syncBodyLock();
  }

  function showLinkError(message) {
    elements.linkError.textContent = message;
    elements.linkError.hidden = false;
  }

  async function submitLink() {
    const url = elements.linkUrlInput.value.trim();
    if (!url) {
      showLinkError("Enter a URL.");
      elements.linkUrlInput.focus();
      return;
    }

    elements.linkError.hidden = true;
    elements.saveLinkBtn.disabled = true;
    const label = elements.saveLinkBtn.querySelector("span");
    const original = label.textContent;
    label.textContent = "Reading the page…";

    try {
      const payload = await requestJson("/api/links", {
        method: "POST",
        body: JSON.stringify({
          url,
          note: elements.linkNoteInput.value.trim(),
          groups: elements.linkGroupsInput.value
        })
      });

      state.links.unshift(payload.link);
      renderLinks();
      closeLinkModal();
      notify(payload.link.fetched
        ? `Saved "${payload.link.title}".`
        : `Saved, but that page could not be read: ${payload.link.fetchError}`,
      payload.link.fetched ? "success" : "warning");
    } catch (error) {
      // The dialog stays open with the message in it: the URL is still in the
      // field, which is what you want if it needs a correction.
      showLinkError(error.message);
    } finally {
      // eslint-disable-next-line require-atomic-updates
      elements.saveLinkBtn.disabled = false;
      label.textContent = original;
    }
  }

  /* Which links have never had an icon fetched at all.
   *
   * Missing, not empty. An empty string is a settled answer — the page was read
   * and offered nothing usable — and asking again on every visit would be a
   * request per card per visit, which is the thing the stored snapshot exists to
   * avoid. Undefined only happens for links saved before icons existed, so this
   * list empties permanently after one run.
   */
  function linksNeedingIcons() {
    return state.links.filter((link) => link.icon === undefined).map((link) => link.id);
  }

  /* Go and get them.
   *
   * One request for the lot. It used to be one PATCH per link, in a queue: seven
   * round trips, seven page reads and seven whole rewrites of links.json, so the
   * icons trickled in over about ten seconds. The server reads the pages a few
   * at a time and writes once, which is the same work done in about a fifth of
   * the time.
   *
   * The whole list comes back, so a link removed or edited in another tab
   * arrives correct rather than being patched over from here.
   */
  /* Take the answer.
   *
   * Its own function because everything here is written after an await, and the
   * list it writes is the server's own, read after the icons were saved — so it
   * is at least as current as anything this tab was holding, whatever else
   * happened while the request was in the air.
   */
  function settleLinkIcons(payload = null) {
    state.linkIconsRunning = false;

    if (payload && Array.isArray(payload.links)) {
      state.links = payload.links;
      state.linkGroups = Array.isArray(payload.groups) ? payload.groups : state.linkGroups;
    }

    renderLinks();
  }

  async function backfillLinkIcons() {
    if (linksNeedingIcons().length === 0 || state.linkIconsRunning) {
      return;
    }

    state.linkIconsRunning = true;

    try {
      const payload = await requestJson("/api/links/icons", { method: "POST" });
      settleLinkIcons(payload);

      if (payload.fetched > 0) {
        setStatus(`Found ${payload.fetched} site icon${payload.fetched === 1 ? "" : "s"}.`, "success");
      }

      // A library big enough to run past the minute's fetch budget finishes on
      // the next visit rather than half-failing on this one.
      if (payload.remaining > 0) {
        setStatus(`${payload.remaining} more icon${payload.remaining === 1 ? "" : "s"} will be fetched next time.`,
          "neutral");
      }
    } catch (error) {
      settleLinkIcons();
      // Decoration that did not arrive. Worth saying, not worth interrupting
      // over — every card is on screen and readable either way.
      setStatus(`Could not fetch the site icons: ${error.message}`, "warning");
    }
  }

  async function refreshLink(id) {
    const current = state.links.find((entry) => entry.id === id);
    if (!current) {
      return;
    }

    try {
      const payload = await requestJson(`/api/links/${encodeURIComponent(id)}`, {
        method: "PATCH",
        // The server replaces the metadata wholesale on a refresh, so the groups
        // are sent back with it or the card comes home unfiled.
        body: JSON.stringify({ refresh: true, groups: linkGroupsOf(current) })
      });

      state.links = state.links.map((link) => (link.id === id ? payload.link : link));
      renderLinks();
      notify(payload.link.fetched ? "Link updated." : `Could not read that page: ${payload.link.fetchError}`,
        payload.link.fetched ? "success" : "warning");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function removeLink(id) {
    const link = state.links.find((entry) => entry.id === id);
    if (!link) {
      return;
    }

    const shouldProceed = await requestConfirmation({
      title: "Remove this link?",
      message: `"${link.title || link.url}" will be removed from your saved links. The site itself is untouched.`,
      confirmLabel: "Remove",
      tone: "danger"
    });

    if (!shouldProceed) {
      return;
    }

    try {
      await requestJson(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.links = state.links.filter((entry) => entry.id !== id);
      renderLinks();
      notify("Link removed.", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  global.AppLinks = {
    renderLinks,
    refreshLinks,
    submitLink,
    openLinkModal,
    closeLinkModal,
    showLinksLoading,
    linksNeedingIcons,
    backfillLinkIcons
  };
})(typeof window === "undefined" ? globalThis : window);
