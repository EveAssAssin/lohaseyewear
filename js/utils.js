(function (window) {
  'use strict';

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.innerText = value || '-';
  }

  function show(el) {
    if (el) el.classList.remove('hidden');
  }

  function hide(el) {
    if (el) el.classList.add('hidden');
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function normalizeApiCode(code) {
    return String(code || '').trim();
  }

  window.LohasUtils = {
    $,
    setText,
    show,
    hide,
    safeJsonParse,
    normalizeApiCode
  };
})(window);
