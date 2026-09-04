/* Accounts.
 *
 * The administrator's view of who else can sign in: the list, the roles, the
 * invitations and the two destructive buttons. Nothing here is reachable
 * without the permission the server checks again on every request.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { requestJson } = global.AppApi;
  const { enterModalLayer, exitModalLayer } = global.AppModal;
  const { syncBodyLock } = global.AppShell;
  const { notify, requestConfirmation } = global.AppNotify;
  const { showFieldError } = global.AppSession;

  async function openUsersModal() {
    state.usersOpen = true;
    elements.usersModal.classList.add("open");
    elements.usersModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.usersModal);
    syncBodyLock();

    await refreshUsers();
  }

  function closeUsersModal() {
    state.usersOpen = false;
    elements.usersModal.classList.remove("open");
    elements.usersModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.usersModal);
    syncBodyLock();
  }

  async function refreshUsers() {
    try {
      const payload = await requestJson("/api/users", { cache: "no-store" });
      state.users = payload.users || [];
      renderUsers();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function renderUsers() {
    elements.usersTableBody.innerHTML = "";

    for (const user of state.users) {
      const row = document.createElement("tr");
      const isSelf = user.id === state.user?.id;

      const name = document.createElement("td");
      name.className = "users-cell-name";
      name.textContent = user.username;
      if (isSelf) {
        const badge = document.createElement("span");
        badge.className = "users-self";
        badge.textContent = "you";
        name.appendChild(badge);
      }
      row.appendChild(name);

      const roleCell = document.createElement("td");
      const roleSelect = document.createElement("select");
      roleSelect.className = "users-role";
      // A control with neither an id nor a name is one the browser will not
      // autofill and cannot report on. Every field made here gets one.
      roleSelect.name = "user-role";
      for (const role of ["viewer", "editor", "admin"]) {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = role;
        option.selected = user.role === role;
        roleSelect.appendChild(option);
      }
      // Changing your own role is the one-click route to locking yourself out.
      roleSelect.disabled = isSelf;
      roleSelect.setAttribute("aria-label", `Role for ${user.username}`);
      roleSelect.addEventListener("change", () => {
        void updateUser(user.id, { role: roleSelect.value });
      });
      roleCell.appendChild(roleSelect);
      row.appendChild(roleCell);

      const status = document.createElement("td");
      status.textContent = user.disabled
        ? "Disabled"
        : user.mustChangePassword ? "Must set password" : "Active";
      row.appendChild(status);

      const lastSeen = document.createElement("td");
      lastSeen.textContent = user.lastLoginAt
        ? new Date(user.lastLoginAt).toLocaleDateString()
        : "Never";
      row.appendChild(lastSeen);

      const actions = document.createElement("td");
      actions.className = "users-actions";

      const resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-sm";
      resetBtn.type = "button";
      resetBtn.textContent = "Reset password";
      resetBtn.addEventListener("click", () => {
        void resetUserPassword(user);
      });
      actions.appendChild(resetBtn);

      if (!isSelf) {
        const disableBtn = document.createElement("button");
        disableBtn.className = "btn btn-sm";
        disableBtn.type = "button";
        disableBtn.textContent = user.disabled ? "Enable" : "Disable";
        disableBtn.addEventListener("click", () => {
          void updateUser(user.id, { disabled: !user.disabled });
        });
        actions.appendChild(disableBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-sm danger";
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          void deleteUser(user);
        });
        actions.appendChild(deleteBtn);
      }

      row.appendChild(actions);
      elements.usersTableBody.appendChild(row);
    }
  }

  async function updateUser(id, changes) {
    try {
      await requestJson(`/api/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes)
      });

      await refreshUsers();
      notify("Account updated.", "success");
    } catch (error) {
      notify(error.message, "error");
      // The select still shows the value that failed; re-render to correct it.
      await refreshUsers();
    }
  }

  async function submitNewUser() {
    showFieldError(elements.newUserError, "");

    try {
      await requestJson("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: elements.newUserName.value,
          password: elements.newUserPassword.value,
          role: elements.newUserRole.value
        })
      });

      const username = elements.newUserName.value;
      elements.newUserName.value = "";
      elements.newUserPassword.value = "";
      elements.newUserRole.value = "viewer";
      elements.newUserDetails.open = false;

      await refreshUsers();
      notify(`Account "${username}" created.`, "success");
    } catch (error) {
      showFieldError(elements.newUserError, error.message);
    }
  }

  async function resetUserPassword(user) {
    const password = window.prompt(
      `New password for "${user.username}".\n\nThey will be required to change it at next sign-in.`
    );

    if (password === null) {
      return;
    }

    try {
      await requestJson(`/api/users/${encodeURIComponent(user.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      await refreshUsers();
      notify(`Password reset for "${user.username}". Their other sessions were signed out.`, "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function deleteUser(user) {
    const confirmed = await requestConfirmation({
      title: `Delete "${user.username}"?`,
      message: "The account is removed and its sessions end immediately. Documents they created are not affected.",
      confirmLabel: "Delete account",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    try {
      await requestJson(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      await refreshUsers();
      notify(`Account "${user.username}" deleted.`, "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  global.AppUsers = {
    openUsersModal,
    closeUsersModal,
    refreshUsers,
    renderUsers,
    updateUser,
    submitNewUser,
    resetUserPassword,
    deleteUser
  };
})(typeof window === "undefined" ? globalThis : window);
