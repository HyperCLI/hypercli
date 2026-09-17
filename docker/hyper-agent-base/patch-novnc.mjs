#!/usr/bin/env node
// Build-time noVNC hardening/patch driver (former pin-novnc-params.py,
// patch_vnc_lite.py, stretch-novnc-display.py — EOL'd with python).
//
// Anchored string surgery on the Debian novnc package webroot. Every anchor
// must match exactly once, so a packaged noVNC update that drifts from these
// anchors fails the build loudly instead of shipping a silently unhardened
// page. Refuses to patch a webroot that already carries a patch marker.
//
// Usage: node patch-novnc.mjs NOVNC_WEBROOT

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- 1. app/ui.js: pin connection params to page-origin defaults ------------

const PIN_MARKER = "hypercli-pinned-params";

const PIN_CONSTANT_ANCHOR = 'import * as WebUtil from "./webutil.js";';
const PIN_CONSTANT = PIN_CONSTANT_ANCHOR + `

// ${PIN_MARKER} (build-time patch, base/patch-novnc.mjs): the RFB connection
// target and VNC password must not be overridable from the URL or from
// persisted settings; they stay pinned to the page defaults.
const HYPERCLI_PINNED_PARAMS = ["host", "port", "path", "password"];`;

const INIT_SETTING_ANCHOR = `        // Check Query string followed by cookie
        let val = WebUtil.getConfigVar(name);
        if (val === null) {
            val = WebUtil.readSetting(name, defVal);
        }`;
const INIT_SETTING_PATCHED = `        // Check Query string followed by cookie.
        // ${PIN_MARKER}: the pinned names keep the caller-provided
        // defaults; URL query/hash and persisted storage cannot override them.
        let val = HYPERCLI_PINNED_PARAMS.includes(name) ? null : WebUtil.getConfigVar(name);
        if (val === null) {
            val = HYPERCLI_PINNED_PARAMS.includes(name) ? defVal : WebUtil.readSetting(name, defVal);
        }`;

const PASSWORD_ANCHOR = `        if (typeof password === 'undefined') {
            password = WebUtil.getConfigVar('password');
            UI.reconnectPassword = password;
        }`;
const PASSWORD_PATCHED = `        if (typeof password === 'undefined') {
            // ${PIN_MARKER}: never accept a VNC password from the URL.
            password = null;
            UI.reconnectPassword = password;
        }`;

// --- 2. vnc_lite.html: CSP/referrer/token-scrub hardening --------------------

const LITE_MARKER = 'name="referrer" content="no-referrer"';

const CHARSET_META = '    <meta charset="utf-8">';
const REFERRER_META = '    <meta name="referrer" content="no-referrer">';
// script-src keeps 'unsafe-inline': the upstream page ships an inline module
// script, which is also what the token scrub below hooks into.
const CSP_META = `    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss: https:">`;

const CONNECT_HANDLER = `        function connectedToServer(e) {
            status("Connected to " + desktopName);
        }`;
const CONNECT_HANDLER_PATCHED = `        function connectedToServer(e) {
            status("Connected to " + desktopName);
            // The ?token= was captured when the ws URL was built above;
            // drop it from the visible URL once connected.
            history.replaceState(null, '', window.location.pathname);
        }`;

const PARAM_TAIL = `        // Set parameters that can be changed on an active connection
        rfb.viewOnly = readQueryVariable('view_only', false);
        rfb.scaleViewport = readQueryVariable('scale', false);`;
const PARAM_TAIL_PATCHED = PARAM_TAIL + `
        // All params are captured; scrub secrets out of the visible URL
        // immediately instead of waiting for the connect event.
        history.replaceState(null, '', window.location.pathname);`;

const BODY_TAG = "<body>";
const BODY_TAG_PATCHED = `<body>
    <noscript><div style="padding:8px;font:bold 12px Helvetica,Arial,sans-serif">noVNC requires JavaScript to reach this desktop.</div></noscript>`;

// --- 3. core/display.js: fill-not-letterbox stretch --------------------------
//
// Upstream Display.autoscale() fits the remote framebuffer inside the
// container (smaller ratio) and leaves pillar/letterbox bars whenever the
// viewer aspect differs from the fixed Xvfb geometry
// (HYPER_DESKTOP_GEOMETRY, 1280x800x24). RFB resizeSession is unavailable
// (x11vnc 0.9.16 ignores SetDesktopSize; Xvfb caps RANDR at the initial
// geometry), so this adds per-axis scale factors, stretches autoscale() per
// axis, and mirrors that in absX()/absY() so pointer mapping stays aligned.

const STRETCH_MARKER = "hypercli-stretch-display";

const SCALE_MEMBER_ANCHOR = "        this._scale = 1.0;";
const SCALE_MEMBER_PATCHED = `    // ${STRETCH_MARKER} (build-time patch, base/patch-novnc.mjs): per-axis
    // scale factors so autoscale() fills the container instead of fit-letterboxing.
    this._scaleX = 1.0;
    this._scaleY = 1.0;
    this._scale = 1.0;`;

const AUTOSCALE_ANCHOR = `    autoscale(containerWidth, containerHeight) {
        let scaleRatio;

        if (containerWidth === 0 || containerHeight === 0) {
            scaleRatio = 0;

        } else {

            const vp = this._viewportLoc;
            const targetAspectRatio = containerWidth / containerHeight;
            const fbAspectRatio = vp.w / vp.h;

            if (fbAspectRatio >= targetAspectRatio) {
                scaleRatio = containerWidth / vp.w;
            } else {
                scaleRatio = containerHeight / vp.h;
            }
        }

        this._rescale(scaleRatio);
    }`;
const AUTOSCALE_PATCHED = `    autoscale(containerWidth, containerHeight) {
        let scaleRatioX;
        let scaleRatioY;

        if (containerWidth === 0 || containerHeight === 0) {
            scaleRatioX = 0;
            scaleRatioY = 0;

        } else {

            // ${STRETCH_MARKER}: stretch each axis to fill the container.
            // The embed always renders the fixed-geometry Xvfb desktop and
            // should fill the viewer rather than letterbox.
            const vp = this._viewportLoc;

            scaleRatioX = containerWidth / vp.w;
            scaleRatioY = containerHeight / vp.h;
        }

        this._rescale(scaleRatioX, scaleRatioY);
    }`;

const RESCALE_ANCHOR = `    _rescale(factor) {
        this._scale = factor;
        const vp = this._viewportLoc;

        // NB(directxman12): If you set the width directly, or set the
        //                   style width to a number, the canvas is cleared.
        //                   However, if you set the style width to a string
        //                   ('NNNpx'), the canvas is scaled without clearing.
        const width = factor * vp.w + 'px';
        const height = factor * vp.h + 'px';

        if ((this._target.style.width !== width) ||
            (this._target.style.height !== height)) {
            this._target.style.width = width;
            this._target.style.height = height;
        }
    }`;
const RESCALE_PATCHED = `    _rescale(factorX, factorY) {
        // ${STRETCH_MARKER}: a single argument still rescales uniformly
        // (viewport changes, \`display.scale =\` re-flows).
        if (factorY === undefined) {
            factorY = factorX;
        }
        this._scaleX = factorX;
        this._scaleY = factorY;
        this._scale = Math.min(factorX, factorY);
        const vp = this._viewportLoc;

        // NB(directxman12): If you set the width directly, or set the
        //                   style width to a number, the canvas is cleared.
        //                   However, if you set the style width to a string
        //                   ('NNNpx'), the canvas is scaled without clearing.
        const width = factorX * vp.w + 'px';
        const height = factorY * vp.h + 'px';

        if ((this._target.style.width !== width) ||
            (this._target.style.height !== height)) {
            this._target.style.width = width;
            this._target.style.height = height;
        }
    }`;

const ABSX_ANCHOR = `    absX(x) {
        if (this._scale === 0) {
            return 0;
        }
        return toSigned32bit(x / this._scale + this._viewportLoc.x);
    }`;
const ABSX_PATCHED = `    absX(x) {
        if (this._scaleX === 0) {
            return 0;
        }
        return toSigned32bit(x / this._scaleX + this._viewportLoc.x);
    }`;

const ABSY_ANCHOR = `    absY(y) {
        if (this._scale === 0) {
            return 0;
        }
        return toSigned32bit(y / this._scale + this._viewportLoc.y);
    }`;
const ABSY_PATCHED = `    absY(y) {
        if (this._scaleY === 0) {
            return 0;
        }
        return toSigned32bit(y / this._scaleY + this._viewportLoc.y);
    }`;

// --- driver ------------------------------------------------------------------

const PATCHES = [
  {
    file: "app/ui.js",
    marker: PIN_MARKER,
    markerCount: 3,
    edits: [
      { anchor: PIN_CONSTANT_ANCHOR, patched: PIN_CONSTANT, keepAnchor: true },
      { anchor: INIT_SETTING_ANCHOR, patched: INIT_SETTING_PATCHED },
      { anchor: PASSWORD_ANCHOR, patched: PASSWORD_PATCHED },
    ],
  },
  {
    file: "vnc_lite.html",
    marker: LITE_MARKER,
    markerCount: 1,
    edits: [
      { anchor: CHARSET_META, patched: `${CHARSET_META}\n\n${REFERRER_META}\n\n${CSP_META}`, keepAnchor: true },
      { anchor: CONNECT_HANDLER, patched: CONNECT_HANDLER_PATCHED },
      { anchor: PARAM_TAIL, patched: PARAM_TAIL_PATCHED, keepAnchor: true },
      { anchor: BODY_TAG, patched: BODY_TAG_PATCHED, keepAnchor: true },
    ],
  },
  {
    file: "core/display.js",
    marker: STRETCH_MARKER,
    markerCount: 3,
    edits: [
      { anchor: SCALE_MEMBER_ANCHOR, patched: SCALE_MEMBER_PATCHED, keepAnchor: true },
      { anchor: AUTOSCALE_ANCHOR, patched: AUTOSCALE_PATCHED, keepAnchor: true },
      { anchor: RESCALE_ANCHOR, patched: RESCALE_PATCHED },
      { anchor: ABSX_ANCHOR, patched: ABSX_PATCHED },
      { anchor: ABSY_ANCHOR, patched: ABSY_PATCHED },
    ],
  },
];

function main() {
  const webroot = process.argv[2];
  if (!webroot) throw new Error("usage: patch-novnc.mjs NOVNC_WEBROOT");
  for (const patch of PATCHES) {
    const target = join(webroot, patch.file);
    let text = readFileSync(target, "utf-8");
    if (text.includes(patch.marker)) {
      throw new Error(`${target} is already patched (${patch.marker})`);
    }
    for (const { anchor, patched, keepAnchor } of patch.edits) {
      const count = text.split(anchor).length - 1;
      if (count !== 1) {
        throw new Error(`${target}: expected exactly 1 anchor match, found ${count}:\n${anchor}`);
      }
      text = text.replace(anchor, patched);
      if (!keepAnchor && text.includes(anchor)) {
        throw new Error(`${target}: anchor survived patching:\n${anchor}`);
      }
    }
    const markers = text.split(patch.marker).length - 1;
    if (markers !== patch.markerCount) {
      throw new Error(`${target}: patch marker count mismatch (${markers} != ${patch.markerCount})`);
    }
    writeFileSync(target, text);
    console.log(`${patch.file}: patched (${patch.marker})`);
  }
}

main();
