"""
PLC MONITORING MODULE
Handles all PLC communication and stroke detection
"""

import time
import threading
from datetime import datetime
import pymcprotocol
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# PLC Configuration
PLC_IP = os.getenv('PLC_IP', '192.168.10.52')
PLC_PORT = int(os.getenv('PLC_PORT', '502'))
PLC_SCAN_INTERVAL = 0.1  # 100ms

class PLCManager:
    def __init__(self):
        self.plc = None
        self.connected = False
        self.previous_states = {}
        self.system_status = {
            'plc_connected': False,
            'last_plc_read': None,
            'total_strokes': 0
        }
        self.monitoring_active = True
        
    def connect(self):
        """Connect to PLC"""
        try:
            if self.plc:
                try:
                    self.plc.close()
                except:
                    pass
            
            print(f"[PLC] Connecting to {PLC_IP}:{PLC_PORT}...")
            self.plc = pymcprotocol.Type4E()
            self.plc.connect(PLC_IP, PLC_PORT)
            self.connected = True
            self.system_status['plc_connected'] = True
            print("[PLC] ✅ Connected successfully")
            return True
            
        except Exception as e:
            self.connected = False
            self.system_status['plc_connected'] = False
            print(f"[PLC] ❌ Connection failed: {e}")
            return False
    
    def get_current_shift(self):
        """Get current shift based on time"""
        hour = datetime.now().hour
        if 6 <= hour < 14:
            return 'A'
        elif 14 <= hour < 22:
            return 'B'
        else:
            return 'C'
    
    def record_stroke(self, machine_id, die_id):
        """Record a stroke in database"""
        try:
            shift = self.get_current_shift()
            today = date.today().isoformat()
            
            # Update daily production
            daily = supabase.table('daily_production')\
                .select('stroke_count')\
                .eq('die_id', die_id)\
                .eq('machine_id', machine_id)\
                .eq('production_date', today)\
                .eq('shift', shift)\
                .execute()
            
            if daily.data:
                # Update existing
                new_count = daily.data[0]['stroke_count'] + 1
                supabase.table('daily_production').update({
                    'stroke_count': new_count
                }).eq('die_id', die_id)\
                  .eq('machine_id', machine_id)\
                  .eq('production_date', today)\
                  .eq('shift', shift)\
                  .execute()
            else:
                # Insert new
                supabase.table('daily_production').insert({
                    'die_id': die_id,
                    'machine_id': machine_id,
                    'production_date': today,
                    'shift': shift,
                    'stroke_count': 1
                }).execute()
            
            # Get total strokes for die
            total_result = supabase.table('daily_production')\
                .select('stroke_count')\
                .eq('die_id', die_id)\
                .execute()
            
            total_strokes = sum(item['stroke_count'] for item in total_result.data)
            
            # Update die total strokes
            supabase.table('dies').update({
                'total_strokes': total_strokes,
                'updated_at': datetime.now().isoformat()
            }).eq('id', die_id).execute()
            
            # Insert stroke count
            supabase.table('stroke_counts').insert({
                'die_id': die_id,
                'machine_id': machine_id,
                'stroke_count': total_strokes,
                'reading_time': datetime.now().isoformat()
            }).execute()
            
            self.system_status['total_strokes'] += 1
            
            # Import here to avoid circular import
            from ticket_generator import check_and_create_tickets
            check_and_create_tickets(die_id, total_strokes)
            
            print(f"[STROKE] ✅ Machine {machine_id}, Die {die_id}: {total_strokes}")
            return True
            
        except Exception as e:
            print(f"[STROKE ERROR] {e}")
            return False
    
    def get_active_dies(self):
        """Get all active dies from database"""
        try:
            active_dies = supabase.table('dies')\
                .select('id, current_machine_id')\
                .eq('status', 'In-Use')\
                .execute()
            
            die_by_machine = {}
            for d in active_dies.data:
                if d['current_machine_id']:
                    die_by_machine[d['current_machine_id']] = d['id']
            
            return die_by_machine
        except Exception as e:
            print(f"[DB ERROR] {e}")
            return {}
    
    def monitor(self):
        """Main monitoring loop"""
        print("[PLC] 📡 Monitor thread started")
        
        while self.monitoring_active:
            try:
                if not self.connected:
                    self.connect()
                    time.sleep(2)
                    continue
                
                # Read PLC inputs (M10 to M36)
                values = self.plc.batchread_bitunits(headdevice="M10", readsize=27)
                
                if values and len(values) == 27:
                    self.system_status['last_plc_read'] = datetime.now().isoformat()
                    
                    # Get active dies
                    die_by_machine = self.get_active_dies()
                    
                    for i, state in enumerate(values):
                        addr = 10 + i
                        machine_id = i + 1
                        prev_state = self.previous_states.get(addr, False)
                        
                        if state and not prev_state:
                            # Rising edge - stroke occurred
                            if machine_id in die_by_machine:
                                die_id = die_by_machine[machine_id]
                                self.record_stroke(machine_id, die_id)
                            else:
                                print(f"[PLC] ⚠️ Machine {machine_id} stroke but no active die")
                        
                        self.previous_states[addr] = state
                
                time.sleep(PLC_SCAN_INTERVAL)
                
            except Exception as e:
                print(f"[PLC] Error: {e}")
                self.connected = False
                self.system_status['plc_connected'] = False
                time.sleep(2)
    
    def start(self):
        """Start monitoring in background thread"""
        thread = threading.Thread(target=self.monitor, daemon=True)
        thread.start()
        return thread
    
    def stop(self):
        """Stop monitoring"""
        self.monitoring_active = False
        if self.plc:
            try:
                self.plc.close()
            except:
                pass
    
    def get_status(self):
        """Get current system status"""
        return self.system_status

# Create global instance
plc_manager = PLCManager()

if __name__ == "__main__":
    # Test run
    print("Starting PLC Monitor Test...")
    plc_manager.start()
    
    try:
        while True:
            time.sleep(5)
            status = plc_manager.get_status()
            print(f"Status: Connected={status['plc_connected']}, Strokes={status['total_strokes']}")
    except KeyboardInterrupt:
        plc_manager.stop()
        print("Stopped")