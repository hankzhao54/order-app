import { useQuery } from '@tanstack/react-query'
import * as api from './api'
import { QK } from './useAction'

// Reference data changes rarely; cache it for a while and share between pages.
const LONG = 5 * 60_000

export const useLocations = () => useQuery({ queryKey: [...QK.locations, 'active'], queryFn: () => api.listLocations(), staleTime: LONG })
export const useCategories = () => useQuery({ queryKey: [...QK.categories, 'active'], queryFn: () => api.listCategories(), staleTime: LONG })
export const useCatalog = () => useQuery({ queryKey: [...QK.catalog, 'active'], queryFn: () => api.listCatalog(), staleTime: LONG })
export const useCutoff = () => useQuery({ queryKey: QK.cutoff, queryFn: api.getCutoff, staleTime: LONG })
