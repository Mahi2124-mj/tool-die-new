"""
TICKET GENERATOR MODULE
Auto-generates tickets based on stroke counts and PM schedules
"""

from datetime import datetime
from supabase import create_client
import secrets
import os
import time
from dotenv import load_dotenv

load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

_checks_cache = {}
_checks_cache_ts = 0.0
_CHECKS_CACHE_TTL = 30.0

def get_checks_map():
    """Cache pm_check_master rows by check_type to reduce DB round trips."""
    global _checks_cache, _checks_cache_ts
    now = time.time()
    if _checks_cache and (now - _checks_cache_ts) < _CHECKS_CACHE_TTL:
        return _checks_cache

    checks = supabase.table('pm_check_master')\
        .select('check_type, check_name, frequency_count')\
        .eq('is_active', True)\
        .execute()

    _checks_cache = {row['check_type']: row for row in (checks.data or [])}
    _checks_cache_ts = now
    return _checks_cache

def log_to_history(die_id, event_type, description, ticket_number=None):
    """Add entry to die history"""
    try:
        supabase.table('die_history').insert({
            'die_id': die_id,
            'event_type': event_type,
            'ticket_number': ticket_number,
            'description': description,
            'created_by': 'System'
        }).execute()
    except Exception as e:
        print(f"[HISTORY ERROR] {e}")

def check_and_create_tickets(die_id, current_count):
    """
    Check if any PM checks are due and create tickets
    Called automatically from PLC monitor
    """
    try:
        print(f"\n[TICKET] 🔍 Checking die {die_id} at {current_count} strokes")
        
        # Get die's active schedules
        schedules = supabase.table('die_check_schedule')\
            .select('*')\
            .eq('die_id', die_id)\
            .eq('status', 'ACTIVE')\
            .execute()
        
        if not schedules.data:
            print(f"[TICKET] ⚠️ No active schedules for die {die_id}")
            return
        
        checks_map = get_checks_map()

        for schedule in schedules.data:
            next_due = schedule['next_due_count']
            check_type = schedule['check_type']
            check_row = checks_map.get(check_type, {})
            check_name = check_row.get('check_name', f'{check_type} Check')
            frequency = check_row.get('frequency_count', next_due or 50000)
            
            print(f"[TICKET] {check_type}: next_due={next_due}, current={current_count}")
            
            if current_count >= next_due:
                print(f"[TICKET] ✅ {check_type} Check is DUE!")
                
                # Check if ticket already exists
                existing = supabase.table('tickets')\
                    .select('id')\
                    .eq('die_id', die_id)\
                    .eq('plan_type', check_type)\
                    .in_('status', ['OPEN', 'IN_PROGRESS', 'QUALITY_CHECK', 'REWORK'])\
                    .execute()
                
                if not existing.data:
                    # Get die info for machine_id
                    die = supabase.table('dies')\
                        .select('current_machine_id')\
                        .eq('id', die_id)\
                        .single()\
                        .execute()
                    
                    # Create ticket
                    ticket_number = f"PM-{datetime.now().strftime('%Y%m%d')}-{secrets.randbelow(10000):04d}"
                    
                    result = supabase.table('tickets').insert({
                        'ticket_number': ticket_number,
                        'die_id': die_id,
                        'machine_id': die.data['current_machine_id'],
                        'plan_type': check_type,
                        'source': 'AUTO',
                        'trigger_count': current_count,
                        'due_count': next_due,
                        'title': f"{check_name} Due",
                        'description': f"{check_name} required at {next_due} strokes. Current: {current_count}",
                        'priority': 'HIGH',
                        'status': 'OPEN',
                        'reported_by': 'System',
                        'reported_at': datetime.now().isoformat()
                    }).execute()
                    
                    print(f"[TICKET] ✅ Created {check_type} ticket #{ticket_number}")
                    
                    # Update schedule
                    supabase.table('die_check_schedule').update({
                        'last_completed_count': current_count,
                        'last_completed_at': datetime.now().isoformat(),
                        'next_due_count': next_due + frequency
                    }).eq('id', schedule['id']).execute()
                    
                    # Log to history
                    log_to_history(
                        die_id=die_id,
                        event_type='TICKET',
                        ticket_number=ticket_number,
                        description=f"Auto-generated {check_type} ticket at {current_count} strokes"
                    )
                else:
                    print(f"[TICKET] ⏭️ Ticket already exists for {check_type}")
        
        print(f"[TICKET] ✅ All checks completed for die {die_id}")
        
    except Exception as e:
        print(f"[TICKET ERROR] {e}")

def initialize_die_checks(die_id):
    """
    Initialize check schedules for a new die
    Called when a new die is added
    """
    try:
        # Get all active checks
        checks = supabase.table('pm_check_master')\
            .select('check_type, frequency_count')\
            .eq('is_active', True)\
            .execute()
        
        for check in checks.data:
            # Check if schedule already exists
            existing = supabase.table('die_check_schedule')\
                .select('id')\
                .eq('die_id', die_id)\
                .eq('check_type', check['check_type'])\
                .execute()
            
            if not existing.data:
                # Create new schedule
                supabase.table('die_check_schedule').insert({
                    'die_id': die_id,
                    'check_type': check['check_type'],
                    'next_due_count': check['frequency_count'],
                    'status': 'ACTIVE'
                }).execute()
                print(f"[INIT] ✅ Created {check['check_type']} schedule for die {die_id}")
        
        return True
        
    except Exception as e:
        print(f"[INIT ERROR] {e}")
        return False

def reset_die_checks(die_id):
    """
    Reset all check schedules for a die
    Used after major maintenance or overhaul
    """
    try:
        # Get current frequencies
        checks = supabase.table('pm_check_master')\
            .select('check_type, frequency_count')\
            .eq('is_active', True)\
            .execute()
        
        for check in checks.data:
            supabase.table('die_check_schedule').update({
                'last_completed_count': 0,
                'last_completed_at': None,
                'next_due_count': check['frequency_count'],
                'updated_at': datetime.now().isoformat()
            }).eq('die_id', die_id)\
              .eq('check_type', check['check_type'])\
              .execute()
        
        # Log to history
        log_to_history(
            die_id=die_id,
            event_type='SYSTEM',
            description="All check schedules reset"
        )
        
        print(f"[RESET] ✅ Reset all checks for die {die_id}")
        return True
        
    except Exception as e:
        print(f"[RESET ERROR] {e}")
        return False

def get_due_checks(die_id=None):
    """
    Get all due checks
    Optional: filter by die_id
    """
    try:
        query = supabase.table('die_check_schedule')\
            .select('*, dies!inner(die_code), pm_check_master!inner(*)')\
            .lte('next_due_count', supabase.table('dies').select('total_strokes'))\
            .eq('status', 'ACTIVE')
        
        if die_id:
            query = query.eq('die_id', die_id)
        
        result = query.execute()
        return result.data
        
    except Exception as e:
        print(f"[DUE CHECKS ERROR] {e}")
        return []

# Test function
if __name__ == "__main__":
    print("🧪 Testing Ticket Generator...")
    
    # Test with a sample die (replace with actual die_id)
    test_die_id = 1
    test_strokes = 75000
    
    print(f"\nChecking die {test_die_id} at {test_strokes} strokes...")
    check_and_create_tickets(test_die_id, test_strokes)
