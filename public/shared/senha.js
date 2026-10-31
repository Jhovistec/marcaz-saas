/* Botão de "olho" para o campo de senha.
   Estado oculto  → ícone de olho FECHADO (mostrar senha)
   Estado visível → ícone de olho ABERTO (esconder senha)
   Todos os campos de senha da página são envolvidos automaticamente. */
function aplicar() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.olho) return;
    input.dataset.olho = '1';
    const caixa = document.createElement('div');
    caixa.className = 'senha-com-olho';
    input.replaceWith(caixa);
    caixa.appendChild(input);
    input.classList.add('senha-entrada');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'olho-senha';
    b.setAttribute('aria-label', 'Mostrar a senha');
    b.setAttribute('aria-pressed', 'false');
    // ícones vetoriais (sem emoji): olho fechado e olho aberto
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    b.addEventListener('click', () => {
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(mostrar));
      b.setAttribute('aria-label', mostrar ? 'Esconder a senha' : 'Mostrar a senha');
      if (mostrar) {
        // olho aberto (sem corte)
        b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      } else {
        // olho fechado (com corte diagonal)
        b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      }
      input.focus();
    });
    caixa.appendChild(b);
  });
}
window.addEventListener('DOMContentLoaded', () => {
  aplicar();
  const mon = new MutationObserver(() => aplicar());
  mon.observe(document.body, { childList: true, subtree: true });
});
