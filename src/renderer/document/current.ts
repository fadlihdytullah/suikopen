import type { Document } from '../../shared/schema/document'
import type { DocumentStore } from '../store/document-store'
import { resolved } from './resolved'

export function resolvedDocument(store: DocumentStore): Document {
  return resolved(store.getState()).document
}

export function resolveError(store: DocumentStore): string | null {
  return resolved(store.getState()).error
}
