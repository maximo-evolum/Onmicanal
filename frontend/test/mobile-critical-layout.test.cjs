/** Archivo: Protege las correcciones críticas de visualización móvil. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = (relativePath) => fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

test("la guía rápida comienza minimizada en teléfonos y recuerda la elección de la persona", () => {
  const help = source("components/contextual-module-help.tsx");
  assert.match(help, /useState\(false\)/);
  assert.match(help, /matchMedia\("\(max-width: 760px\)"\)/);
  assert.match(help, /savedState === "expanded"/);
  assert.match(help, /sessionStorage\.setItem\(`evolum-module-help:\$\{pathname\}`, "expanded"\)/);
});

test("Chats móviles separa la lista del hilo y conserva las acciones de la conversación", () => {
  const inbox = source("components/inbox-shell.tsx");
  assert.match(inbox, /mobileConversationOpen/);
  assert.match(inbox, /inbox-mobile-thread-open/);
  assert.match(inbox, /‹ Volver a chats/);
  assert.match(inbox, /inbox-mobile-thread-actions/);
  assert.match(inbox, /onSelect=\{selectConversation\}/);
});

test("el CSS móvil cancela la reserva del rail y deja espacio bajo la barra fija", () => {
  const css = source("app/globals.css");
  assert.match(css, /PRIORIDAD CRÍTICA · móvil/);
  assert.match(css, /padding-top: calc\(var\(--evolum-chrome-height, 62px\) \+ 18px\) !important/);
  assert.match(css, /\.inbox-unified-shell\.nav-collapsed \.inbox-unified-main/);
  assert.match(css, /padding-left: 0 !important/);
  assert.match(css, /\.inbox-mobile-thread-open \.inbox-chat-feed-panel/);
  assert.match(css, /El menú EV es un panel contextual en teléfono/);
  assert.match(css, /position: fixed !important/);
});

test("el menú EV inicia cerrado en móvil y se abre como panel sin alterar el layout", () => {
  const sidebar = source("components/evolum-sidebar.tsx");
  assert.match(sidebar, /const \[isMobileViewport, setIsMobileViewport\] = useState\(false\)/);
  assert.match(sidebar, /const \[mobileMenuOpen, setMobileMenuOpen\] = useState\(false\)/);
  assert.match(sidebar, /const navigationOpen = isMobileViewport \? mobileMenuOpen : isOpen/);
  assert.match(sidebar, /if \(isMobileViewport\) \{/);
  assert.match(sidebar, /if \(!navigationOpen\) \{/);
});
