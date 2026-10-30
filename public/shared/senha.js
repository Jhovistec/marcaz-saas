/* Aplica o botão de "olho" em todo campo de senha de todas as telas.
   Roda depois que a página os cria; nenhum input de senha fica de fora. */
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
    b.setAttribute('aria-label', 'Mostrar ou esconder a senha');
    b.setAttribute('aria-pressed', 'false');
    b.textContent = '👁️';
    b.addEventListener('click', () => {
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(mostrar));
      b.textContent = mostrar ? '🙈' : '👁️';
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
