# Lista zadan

Prosta lokalna aplikacja todo z logowaniem w IndexedDB oraz integracja z OpenAI do generowania i podsumowywania zadan.

## Uruchomienie

1. Skopiuj `.env.example` do `.env`.
2. Wpisz lokalny klucz API:

```env
OPENAI_API_KEY=sk-proj-your-key
OPENAI_MODEL=gpt-5-mini
```

3. Uruchom serwer:

```bash
npm start
```

4. Otworz aplikacje:

```text
http://127.0.0.1:3000
```

## Vercel

Aplikacja jest statyczna, pliki frontendowe sa w katalogu `public/`, a endpointy AI dzialaja jako Vercel Functions w katalogu `api/`.

W ustawieniach projektu Vercel dodaj zmienne srodowiskowe:

```text
OPENAI_API_KEY
OPENAI_MODEL
```

`OPENAI_MODEL` jest opcjonalne. Bez tej zmiennej aplikacja uzyje `gpt-5-mini`.

## Bezpieczenstwo

Plik `.env` jest ignorowany przez Git i nie powinien trafic do repozytorium. Jezeli klucz API zostal kiedykolwiek publicznie ujawniony, uniewaznij go w panelu OpenAI i wygeneruj nowy.
