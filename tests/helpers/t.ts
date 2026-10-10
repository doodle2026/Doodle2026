import { makeT } from '../../src/i18n/translator';
import en from '../../messages/en.json';
import da from '../../messages/da.json';
import fr from '../../messages/fr.json';
import de from '../../messages/de.json';
/** Catalog translators for pure-helper tests. */
export const T = { en: makeT('en', en), da: makeT('da', da, en), fr: makeT('fr', fr, en), de: makeT('de', de, en) };
/** Rendered markup only: drops <script> payloads (the client message catalog is inlined there). */
export const markup = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/g, '');
