import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth, useIsCoaching } from './auth';

export type Course = { _id: string; code: string; name: string; category?: string; active?: boolean; feeAmount?: number; durationDays?: number; nextBatchDate?: string; pageUrl?: string };

let cache: { tenant: string; list: Course[] } | null = null;

export function loadCourses(tenantId: string, force = false): Promise<Course[]> {
  if (!force && cache?.tenant === tenantId) return Promise.resolve(cache.list);
  return api<Course[]>('/courses').then((list) => {
    cache = { tenant: tenantId, list };
    return list;
  });
}

/** Courses of a coaching business (empty for other businesses) */
export function useCourses() {
  const coaching = useIsCoaching();
  const tenantId = useAuth().session?.tenant?._id || '';
  const [list, setList] = useState<Course[]>(cache?.tenant === tenantId ? cache.list : []);
  useEffect(() => {
    if (!coaching || !tenantId) return;
    let alive = true;
    loadCourses(tenantId).then((l) => alive && setList(l)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [coaching, tenantId]);
  const byCode = Object.fromEntries(list.map((c) => [c.code, c]));
  return { list, label: (code?: string) => (code ? byCode[code]?.name || code : '—'), byCode };
}
