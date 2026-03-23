import { supabase } from './supabaseClient';
import type { CareerPlan, DirectionRecommendation, UserProfile } from '../types';

export interface SavedPlan {
  id: string;
  user_id: string;
  title: string;
  direction_name: string;
  match_score: number;
  plan_data: CareerPlan;
  direction_data: DirectionRecommendation;
  profile_data: UserProfile;
  total_weeks: number;
  completed_tasks: number;
  total_tasks: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function countCompleted(plan: CareerPlan): { completed: number; total: number } {
  const total = plan.tasks.length;
  const completed = plan.tasks.filter(t => t.isCompleted).length;
  return { completed, total };
}

export async function getSavedPlans(userId: string): Promise<{ data: SavedPlan[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('saved_career_plans')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return { data: (data || []) as SavedPlan[] };
  } catch (error: any) {
    console.error('获取计划列表失败:', error);
    return { data: [], error: error.message };
  }
}

export async function createSavedPlan(params: {
  userId: string;
  plan: CareerPlan;
  direction: DirectionRecommendation;
  profile: UserProfile;
}): Promise<{ data: SavedPlan | null; error?: string }> {
  try {
    const { completed, total } = countCompleted(params.plan);
    const { data, error } = await supabase
      .from('saved_career_plans')
      .insert({
        user_id: params.userId,
        title: params.plan.title,
        direction_name: params.direction.directionName,
        match_score: params.direction.matchScore,
        plan_data: params.plan,
        direction_data: params.direction,
        profile_data: params.profile,
        total_weeks: params.plan.totalWeeks,
        completed_tasks: completed,
        total_tasks: total,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;
    return { data: data as SavedPlan };
  } catch (error: any) {
    console.error('保存计划失败:', error);
    return { data: null, error: error.message };
  }
}

export async function updatePlanData(
  planId: string,
  plan: CareerPlan,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { completed, total } = countCompleted(plan);
    const { error } = await supabase
      .from('saved_career_plans')
      .update({
        plan_data: plan,
        completed_tasks: completed,
        total_tasks: total,
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('更新计划失败:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteSavedPlan(planId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('saved_career_plans')
      .delete()
      .eq('id', planId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('删除计划失败:', error);
    return { success: false, error: error.message };
  }
}
