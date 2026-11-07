import test from 'node:test';
import assert from 'node:assert/strict';
import {patchPaymentMethodNavigation} from './fix-wallet-stars-method-navigation.mjs';
const src=[
 'function renderWallet(){',
 '  box.innerHTML = walletDeposit();',
 '    /* RUSTUP_STARS_WALLET_EMBED_V1 */',
 "    if (WF.tab === 'deposit' && WF.dep === 'gifts') {",
 "      box.innerHTML = '<div id=\"rustupStarsBody\"></div>';",
 "    } else if (WF.tab === 'deposit' && WF.dep === 'crypto') {",
 "      box.innerHTML = '<div class=\"w-glass w-panel\"><h3 class=\"w-h3\">Криптовалюта</h3><p class=\"w-note\">Цифровые покупки в Telegram доступны только за Stars. Криптоплатежи здесь отключены, внешний провайдер проверяется отдельно.</p></div>';",
 '    }',
 '}'
].join('\n');
test('wallet method tabs stay visible in Stars and crypto deposit panels',()=>{
 const updated=patchPaymentMethodNavigation(src);
 assert.equal(updated.match(/box\.querySelector\('\.wm-grid'\)/g).length,2);
 assert.match(updated,/methodChoices \+ '<div id="rustupStarsBody"/);
 assert.match(updated,/box\.innerHTML = methodChoices \+ '<div class="w-glass/);
 assert.match(updated,/RUSTUP_STARS_KEEP_PAYMENT_CHOICES_V1/);
 assert.throws(()=>patchPaymentMethodNavigation(updated),/already_fixed/);
});
test('reject altered or missing wallet anchors, no silent partial edits',()=>{
 assert.throws(()=>patchPaymentMethodNavigation(src.replace("RUSTUP_STARS_WALLET_EMBED_V1","other")),/unknown_wallet_layout/);
 assert.throws(()=>patchPaymentMethodNavigation(src.replace('Цифровые покупки','Other copy')),/unknown_wallet_layout/);
});
