/* Criptografia de ponta a ponta: os dados são embaralhados AQUI, com uma chave que sai da sua frase-senha.
   A nuvem só recebe o resultado embaralhado; sem a frase-senha, ninguém (nem o Google) consegue ler.
   Usa a Web Crypto, que já vem no navegador: PBKDF2-SHA256 para tirar a chave da frase, AES-GCM para embaralhar. */
'use strict';

const CRIPTO_ITERACOES = 600000;   // quanto maior, mais lento para quem tentar adivinhar a frase-senha

function paraB64(bytes){
  const u = new Uint8Array(bytes);
  let s = '';
  for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function deB64(txt){
  const s = atob(txt), u = new Uint8Array(s.length);
  for(let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const bytesAleatorios = n => crypto.getRandomValues(new Uint8Array(n));

// A chave não pode ser exportada: nem o próprio app consegue tirá-la do navegador.
async function derivarChave(frase, sal, iteracoes = CRIPTO_ITERACOES){
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(frase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt:sal, iterations:iteracoes},
    base, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
}

async function cifrar(chave, texto){
  const iv = bytesAleatorios(12);   // nunca se repete: cada envio usa um novo
  const c = await crypto.subtle.encrypt({name:'AES-GCM', iv}, chave, new TextEncoder().encode(texto));
  return {iv: paraB64(iv), cifra: paraB64(c)};
}

// O AES-GCM também confere se nada foi alterado: frase errada ou dado mexido dão erro, nunca lixo.
async function decifrar(chave, {iv, cifra}){
  try{
    const t = await crypto.subtle.decrypt({name:'AES-GCM', iv:deB64(iv)}, chave, deB64(cifra));
    return new TextDecoder().decode(t);
  }catch(e){
    throw new Error('Frase-senha errada (ou os dados da nuvem estão danificados).');
  }
}

/* ---------------------------------------------------------------- chave guardada neste aparelho */
// Fica no IndexedDB (outro "armário" do navegador), que guarda a chave sem expor o conteúdo dela.
function abrirCofre(){
  return new Promise((ok, falhou) => {
    const r = indexedDB.open('dash-cofre', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('chaves');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falhou(r.error);
  });
}
async function noCofre(modo, fazer){
  const db = await abrirCofre();
  try{
    return await new Promise((ok, falhou) => {
      const tx = db.transaction('chaves', modo), r = fazer(tx.objectStore('chaves'));
      tx.oncomplete = () => ok(r && r.result);
      tx.onerror = () => falhou(tx.error);
    });
  }finally{ db.close(); }
}
const guardarChave = (chave, sal) => noCofre('readwrite', s => s.put({chave, sal}, 'principal'));
const lerChave = () => noCofre('readonly', s => s.get('principal'));
const esquecerChave = () => noCofre('readwrite', s => s.delete('principal'));
