hyper_desktop_enabled() {
  case "$(printf '%s' "${HYPER_DESKTOP_ENABLED:-0}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

hyper_configure_plank_dock() {
  local dock_dir="${HOME:-/home/node}/.config/plank/dock1/launchers"
  mkdir -p "${dock_dir}"
  local app
  for app in google-chrome thunar xfce4-terminal; do
    printf '[PlankDockItemPreferences]\nLauncher=file:///usr/share/applications/%s.desktop\n' "${app}" \
      >"${dock_dir}/${app}.dockitem"
  done
  if command -v dconf >/dev/null 2>&1; then
    dconf write /net/launchpad/plank/docks/dock1/position "'bottom'" >/dev/null 2>&1 || true
    dconf write /net/launchpad/plank/docks/dock1/icon-size "48" >/dev/null 2>&1 || true
  else
    echo "[desktop] dconf is not available; skipping dock settings" >&2
  fi
}

hyper_start_desktop() {
  if ! command -v Xvfb >/dev/null 2>&1 || \
     ! command -v x11vnc >/dev/null 2>&1 || \
     ! command -v websockify >/dev/null 2>&1 || \
     ! command -v dbus-launch >/dev/null 2>&1 || \
     ! command -v xfwm4 >/dev/null 2>&1 || \
     ! command -v xfce4-terminal >/dev/null 2>&1 || \
     ! command -v thunar >/dev/null 2>&1; then
    echo "[desktop] desktop requested but desktop runtime packages are not installed" >&2
    exit 1
  fi

  export DISPLAY="${DISPLAY:-:99}"
  # Desktop Chrome egresses through the cluster proxy by default; an explicit
  # HYPER_PROXY_HOST (proxy URL or boolean-ish off) still overrides.
  export HYPER_PROXY_HOST="${HYPER_PROXY_HOST:-true}"
  local desktop_port="${HYPER_DESKTOP_PORT:-${OPENCLAW_DESKTOP_PORT:-3000}}"
  local geometry="${HYPER_DESKTOP_GEOMETRY:-1280x800x24}"
  local vnc_port="${HYPER_VNC_PORT:-5900}"

  mkdir -p "${HOME:-/home/node}/.config/google-chrome"
  echo "[desktop] starting ${DISPLAY}, noVNC port ${desktop_port}"

  # -noreset: without it the last X client disconnecting triggers a server
  # regeneration that resets the root window to black. feh/xsetroot are
  # transient clients, so the background paint below could be wiped the
  # moment feh exits — timing-dependent, exit code 0 either way.
  Xvfb "${DISPLAY}" -screen 0 "${geometry}" -ac +extension RANDR -noreset &
  sleep 1
  eval "$(dbus-launch --sh-syntax)"
  export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID
  xfwm4 --replace >/tmp/xfwm4.log 2>&1 &
  # Paint after the WM holds a persistent connection (belt and braces for the
  # reset race above), and keep a log: feh can fail silently otherwise.
  local background_image="${HYPER_DESKTOP_BACKGROUND_IMAGE:-/opt/hypercli/share/hypercli-bg.png}"
  if [ -s "${background_image}" ] && command -v feh >/dev/null 2>&1; then
    feh --no-fehbg --bg-fill "${background_image}" >/tmp/desktop-bg.log 2>&1 || \
      xsetroot -solid "${HYPER_DESKTOP_BACKGROUND_COLOR:-#071A2F}" >>/tmp/desktop-bg.log 2>&1 || true
  else
    xsetroot -solid "${HYPER_DESKTOP_BACKGROUND_COLOR:-#071A2F}" >/tmp/desktop-bg.log 2>&1 || true
  fi
  hyper_configure_plank_dock
  if command -v plank >/dev/null 2>&1; then
    plank >>/tmp/plank.log 2>&1 &
  else
    echo "[desktop] plank is not available; skipping dock" >&2
  fi
  local welcome_chrome="/opt/hypercli/bin/hypercli-chrome"
  if [ -x "${welcome_chrome}" ]; then
    "${welcome_chrome}" >/tmp/hypercli-chrome-welcome.log 2>&1 &
  else
    echo "[desktop] ${welcome_chrome} is not available; skipping welcome window" >&2
  fi
  x11vnc -display "${DISPLAY}" -rfbport "${vnc_port}" -localhost -forever -shared -nopw >/tmp/x11vnc.log 2>&1 &
  websockify --heartbeat 30 --web /usr/share/novnc/ "${desktop_port}" "localhost:${vnc_port}" >/tmp/novnc.log 2>&1 &
}
