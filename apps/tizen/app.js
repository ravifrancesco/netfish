// Netfish for Samsung TVs: the start page (in its own file: a TV app may only run its own files).
(function () {
  var SERVER = 'netfish.server';
  var OPENED = 'netfish.opened';
  // Filled in by scripts/build-tizen.sh; Netfish shows it in Settings → Devices.
  var VERSION = '__VERSION__';
  var KEY = { up: 38, down: 40, enter: 13, back: 10009 };
  var opening = document.getElementById('opening');
  var openingText = document.getElementById('opening-text');
  var setup = document.getElementById('setup');
  var input = document.getElementById('url');
  var go = document.getElementById('go');
  var error = document.getElementById('error');
  var old = document.getElementById('old');
  var screen = '';
  var pending = null;

  // Italian when the TV's language is Italian, English otherwise. Keys are the exact English text.
  var lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  var italian = /^it\b/i.test(lang);
  var IT = {
    'Opening Netfish…': 'Apertura di Netfish…',
    'Opening Netfish at {address}…': 'Apertura di Netfish su {address}…',
    'Press ▲ on the remote to use a different server.': 'Premi ▲ sul telecomando per usare un altro server.',
    "This TV's web browser is older than Netfish needs. Netfish works on Samsung TVs from 2022 onwards.":
      'Il browser di questa TV è troppo vecchio per Netfish. Netfish funziona sulle TV Samsung dal 2022 in poi.',
    'Try anyway': 'Prova comunque',
    'Where is your Netfish server?': "Dov'è il tuo server Netfish?",
    'Server address': 'Indirizzo del server',
    Connect: 'Connetti',
    'Connecting…': 'Connessione in corso…',
    'The address you open Netfish at in a browser, e.g. 192.168.1.50 or http://raspberrypi.local:7777. Press OK on the field to type with the remote.':
      "L'indirizzo con cui apri Netfish nel browser, ad es. 192.168.1.50 o http://raspberrypi.local:7777. Premi OK sul campo per scrivere con il telecomando.",
    'Enter the address of your Netfish server': "Inserisci l'indirizzo del tuo server Netfish",
    "That doesn't look like an address": 'Questo non sembra un indirizzo',
    "{origin} doesn't look like a Netfish server.": '{origin} non sembra un server Netfish.',
    "Can't reach {origin}. Is the server on, and is the TV on the same network?":
      'Impossibile raggiungere {origin}. Il server è acceso e la TV è sulla stessa rete?'
  };

  /** t('Hello {name}', { name: 'Ann' }) → the Italian (or the English) with {placeholders} filled in. */
  function t(text, values) {
    var out = (italian && IT[text]) || text;
    return out.replace(/\{(\w+)\}/g, function (match, name) {
      return values && name in values ? String(values[name]) : match;
    });
  }

  // The page's own text, written in English above.
  if (italian) {
    document.documentElement.lang = 'it';
    var texts = document.querySelectorAll('[data-t]');
    for (var i = 0; i < texts.length; i++) {
      texts[i].textContent = t(texts[i].textContent.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' '));
    }
  }

  function exitApp() {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) {
      window.close();
    }
  }

  // Back on Netfish's first page comes back here: close the app, like any TV app.
  window.addEventListener('pageshow', function () {
    if (sessionStorage.getItem(OPENED)) {
      sessionStorage.removeItem(OPENED);
      exitApp();
    }
  });

  // Play/pause and the other media keys reach Netfish's player only once registered.
  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'].forEach(function (name) {
      tizen.tvinputdevice.registerKey(name);
    });
  } catch (e) {}

  function show(name) {
    screen = name;
    opening.className = name === 'opening' ? '' : 'hidden';
    setup.className = name === 'setup' ? '' : 'hidden';
    old.className = name === 'old' ? '' : 'hidden';
  }

  /** "192.168.1.50" → http://192.168.1.50:7777. Real domains keep their own port. */
  function normalize(text) {
    var value = (text || '').replace(/^\s+|\s+$/g, '');
    if (!value) throw new Error(t('Enter the address of your Netfish server'));
    if (!/^https?:\/\//i.test(value)) value = 'http://' + value;
    var match = /^(https?):\/\/([^\/:?#]+)(?::(\d+))?/i.exec(value);
    if (!match) throw new Error(t("That doesn't look like an address"));
    var scheme = match[1].toLowerCase();
    var host = match[2];
    var port = match[3];
    var local = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /\.local$/.test(host) || host.indexOf('.') < 0;
    if (!port && scheme === 'http' && local) port = '7777';
    return scheme + '://' + host + (port ? ':' + port : '');
  }

  /** Make sure the address really is a Netfish server. */
  function probe(origin, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', origin + '/api/health');
    xhr.timeout = 7000;
    xhr.onload = function () {
      var body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 200 && body && body.name === 'netfish') done(null);
      else done(t("{origin} doesn't look like a Netfish server.", { origin: origin }));
    };
    xhr.onerror = xhr.ontimeout = function () {
      done(t("Can't reach {origin}. Is the server on, and is the TV on the same network?", { origin: origin }));
    };
    xhr.send();
  }

  function open(origin) {
    localStorage.setItem(SERVER, origin);
    sessionStorage.setItem(OPENED, '1');
    location.href = origin + '/?tv=1' + (/^\d+\.\d+\.\d+$/.test(VERSION) ? '&app=samsung&v=' + VERSION : '');
  }

  function showSetup(message) {
    if (pending) clearTimeout(pending);
    pending = null;
    show('setup');
    input.value = localStorage.getItem(SERVER) || '';
    error.textContent = message || '';
    go.disabled = false;
    go.textContent = t('Connect');
    (input.value ? go : input).focus();
  }

  function start() {
    var saved = localStorage.getItem(SERVER);
    if (!saved) return showSetup();
    show('opening');
    openingText.textContent = t('Opening Netfish at {address}…', { address: saved.replace(/^https?:\/\//, '') });
    var began = Date.now();
    probe(saved, function (problem) {
      if (screen !== 'opening') return;
      if (problem) return showSetup(problem);
      // A moment to press ▲ for a different server.
      pending = setTimeout(function () { open(saved); }, Math.max(0, 1200 - (Date.now() - began)));
    });
  }

  setup.addEventListener('submit', function (e) {
    e.preventDefault();
    var origin;
    try {
      origin = normalize(input.value);
    } catch (err) {
      error.textContent = err.message;
      return;
    }
    error.textContent = '';
    go.disabled = true;
    go.textContent = t('Connecting…');
    probe(origin, function (problem) {
      if (problem) {
        error.textContent = problem;
        go.disabled = false;
        go.textContent = t('Connect');
        go.focus();
      } else {
        open(origin);
      }
    });
  });

  document.getElementById('anyway').addEventListener('click', start);

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === KEY.back || e.key === 'XF86Back' || e.key === 'GoBack') {
      e.preventDefault();
      return exitApp();
    }
    if (screen === 'opening' && e.keyCode === KEY.up) {
      e.preventDefault();
      return showSetup();
    }
    if (screen === 'setup' && (e.keyCode === KEY.up || e.keyCode === KEY.down)) {
      e.preventDefault();
      (e.keyCode === KEY.down ? go : input).focus();
    }
  });

  // Netfish's interface needs a 2022-or-newer Samsung TV (Tizen 6.5, its browser is Chromium 85).
  var system = /Tizen\s?(\d+(?:\.\d+)?)/.exec(navigator.userAgent);
  if (system && parseFloat(system[1]) < 6.5) {
    show('old');
    document.getElementById('anyway').focus();
  } else {
    start();
  }
})();
