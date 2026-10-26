import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_core import Sheet, U, q

OUT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ='eeg_v1'

R0402='Resistor_SMD:R_0402_1005Metric'
C0402='Capacitor_SMD:C_0402_1005Metric'
C0805='Capacitor_SMD:C_0805_2012Metric'
LED0603='LED_SMD:LED_0603_1608Metric'
SOT236='Package_TO_SOT_SMD:SOT-23-6'
SOT235='Package_TO_SOT_SMD:SOT-23-5'
SOIC8='Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'

RAILS={'GND','+3V3','+5V','AVDD','AVSS','-5V','-10V','VBAT','5V_USB','5V_BOOST'}
XNETS={'MOSI','MISO','SCLK','CS','DRDY','START','ADS_RESET','PWDN','SRB1','SRB2',
       'LED_STATUS','LED_DATA'}
GLOB=RAILS|XNETS

root_uuid=U('sheet:eeg_v1.kicad_sch')

# ======================================================================
# ANALOG SHEET
# ======================================================================
def build_analog():
    s=Sheet('analog','analog.kicad_sch',paper='A2',title='Analog front-end: ADS1299 + probe inputs')
    s.instpath=f'/{root_uuid}/{U("sheetsym:analog")}'
    s.text(20,18,'ANALOG FRONT-END  -  ADS1299 8-channel EEG',3.0)
    s.text(20,24,'ESD: USBLC6-2SC6 (was TPD4E1B06DCKR in v1) - VBUS pin tied to AVDD',1.5)

    ADS='Analog_ADC:ADS1299'
    conns={}
    for i in range(1,9):
        conns[str(2*(8-i)+1)]=f'IN{9-i}N' if False else None
    # explicit ADS1299 pin map
    pinnet={
      '1':'GND','2':'GND','3':'GND','4':'GND','5':'GND','6':'GND','7':'GND','8':'GND',
      '9':'GND','10':'GND','11':'GND','12':'GND','13':'IN2N','14':'IN2P','15':'IN1N','16':'IN1P',
      '17':'SRB1','18':'SRB2',
      '19':'AVDD','20':'AVSS','21':'AVDD','22':'AVDD','23':'AVSS',
      '24':'VREFP','25':'AVSS','26':'VCAP4','27':None,'28':'VCAP1','29':None,'30':'VCAP2',
      '31':'AVSS','32':'AVSS','33':'GND','34':'MOSI','35':'PWDN','36':'ADS_RESET','37':'GND',
      '38':'START','39':'CS','40':'SCLK','41':'GND','42':'ADS_GPIO1','43':'MISO','44':'ADS_GPIO2',
      '45':'ADS_GPIO3','46':'ADS_GPIO4','47':'DRDY','48':'+3V3','49':'GND','50':'+3V3','51':'GND',
      '52':'CLKSEL','53':'AVSS','54':'AVDD','55':'VCAP3','56':'AVDD','57':'AVSS','58':'AVSS',
      '59':'AVDD','60':'GND','61':'BIASINV','62':'BIASIN','63':'BIASOUT','64':None}
    s.place(ADS,'U1','ADS1299IPAGR',180,120,pinnet,
            footprint='Package_QFP:TQFP-64_10x10mm_P0.5mm',glob_nets=GLOB)

    # ---- probe input RC filters + ESD ----
    x0=50
    for ch in range(2,0,-1):
        row=2-ch
        y=45+row*44
        for k,sign in enumerate(['-','+']):
            yy=y+k*22
            net_in=f'Probe_{ch}{sign}'
            net_out=f'IN{ch}{"N" if sign=="-" else "P"}'
            s.place('Device:R',f'R{(2-ch)*2+k+1}','2k',x0+40,yy,
                    {'1':net_in,'2':net_out},footprint=R0402,glob_nets=GLOB)
            s.place('Device:C',f'C{(2-ch)*2+k+1}','1nF',x0+70,yy,
                    {'1':net_out,'2':'GND'},footprint=C0402,glob_nets=GLOB)
        # ESD array per channel pair
        s.place('Power_Protection:USBLC6-2SC6',f'D{3-ch}','USBLC6-2SC6',x0,y+11,
                {'1':f'Probe_{ch}-','6':f'Probe_{ch}-','3':f'Probe_{ch}+','4':f'Probe_{ch}+',
                 '2':'GND','5':'AVDD'},footprint=SOT236,glob_nets=GLOB)

    # ---- bias network ----
    bx=300
    s.text(bx-10,44,'BIAS / DRL',2.0)
    s.place('Device:R','R5','1M',bx,60,{'1':'BIASINV','2':'BIASOUT'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:C','C5','1nF',bx+15,60,{'1':'BIASINV','2':'BIASOUT'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:R','R6','2k',bx+35,60,{'1':'BIASOUT','2':'BIAS_PROBE'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:C','C6','1nF',bx+50,60,{'1':'BIAS_PROBE','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:C','C7','1nF',bx+65,60,{'1':'BIASIN','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:R','R7','0R',bx+80,60,{'1':'BIASIN','2':'BIAS_PROBE'},footprint=R0402,glob_nets=GLOB)
    s.place('Power_Protection:USBLC6-2SC6','D3','USBLC6-2SC6',bx+40,85,
            {'1':'BIAS_PROBE','6':'BIAS_PROBE','3':'SRB1','4':'SRB1','2':'GND','5':'AVDD'},
            footprint=SOT236,glob_nets=GLOB)

    # ---- ADS1299 support passives ----
    px=300; py=120
    sup=[('C8','10uF','VREFP','AVSS',C0805),('C9','0.1uF','VREFP','AVSS',C0402),
         ('C10','1uF','VCAP1','AVSS',C0402),('C11','100uF','VCAP1','AVSS','Capacitor_Tantalum_SMD:CP_EIA-3528-21_Kemet-B'),
         ('C12','1nF','VCAP2','AVSS',C0402),
         ('C13','1uF','VCAP3','AVSS',C0402),('C14','0.1uF','VCAP3','AVSS',C0402),
         ('C15','0.1uF','VCAP4','AVSS',C0402),
         ('C16','0.1uF','AVDD','GND',C0402),('C17','1uF','AVDD','GND',C0402),('C18','10uF','AVDD','GND',C0805),
         ('C19','0.1uF','AVSS','GND',C0402),('C20','1uF','AVSS','GND',C0402),('C21','10uF','AVSS','GND',C0805),
         ('C22','0.1uF','+3V3','GND',C0402),('C23','1uF','+3V3','GND',C0402)]
    for i,(ref,val,a,b,fp) in enumerate(sup):
        s.place('Device:C',ref,val,px+(i%8)*20,py+(i//8)*30,{'1':a,'2':b},footprint=fp,glob_nets=GLOB)

    # pulldowns / pullups
    pd=[('R8','10k','ADS_GPIO1','GND'),('R9','10k','ADS_GPIO2','GND'),
        ('R10','10k','ADS_GPIO3','GND'),('R11','10k','ADS_GPIO4','GND'),
        ('R12','10k','CLKSEL','+3V3'),('R13','10k','PWDN','+3V3')]
    for i,(ref,val,a,b) in enumerate(pd):
        s.place('Device:R',ref,val,px+i*20,py+70,{'1':a,'2':b},footprint=R0402,glob_nets=GLOB)

    # ---- electrode connector ----
    order=['Probe_1-','Probe_1+','Probe_2-','Probe_2+','BIAS_PROBE','BIAS_PROBE',
           'SRB1','SRB2','GND','GND']
    jn={str(i):net for i,net in enumerate(order,1)}
    s.place('Connector_Generic:Conn_02x05_Odd_Even','J1','Electrode header 2x5',470,90,jn,
            footprint='Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical',glob_nets=GLOB)

    for i in range(1,5):
        s.place('Mechanical:MountingHole_Pad',f'H{i}','MountingHole',470+ (i-1)*18,200,
                {'1':'GND'},footprint='MountingHole:MountingHole_3.2mm_M3_Pad',glob_nets=GLOB)
    return s

# ======================================================================
# POWER SHEET
# ======================================================================
def build_power():
    s=Sheet('power','power.kicad_sch',paper='A2',title='Power: USB-C charge, battery, boost, +/-2.5V analog rails')
    s.instpath=f'/{root_uuid}/{U("sheetsym:power")}'
    s.ref_offset=100
    s.text(20,18,'POWER',3.0)
    s.text(20,24,'Rails: VBAT -> MT3608 boost 5V -> SPX3819 (+2.5V AVDD) and 2x ICL7660 (-10V) -> LM337 (-2.5V AVSS)',1.5)

    # --- USB-C charge input ---
    s.place('Connector:USB_C_Receptacle_USB2.0_16P','J1','USB-C charge in',55,60,
            footprint='Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
            conns={'A1':'GND','A4':'5V_USB','A5':'CC1','A6':'USB_DP','A7':'USB_DN','A9':'5V_USB','A12':'GND',
             'B1':'GND','B4':'5V_USB','B5':'CC2','B6':'USB_DP','B7':'USB_DN','B9':'5V_USB','B12':'GND',
             'A8':None,'B8':None,'SH':'GND'},glob_nets=GLOB)
    s.place('Device:R','R1','5.1k',95,45,{'1':'CC1','2':'GND'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:R','R2','5.1k',110,45,{'1':'CC2','2':'GND'},footprint=R0402,glob_nets=GLOB)

    # --- TP4056 charger ---
    s.place('Battery_Management:TP4056-42-ESOP8','U1','TP4056',150,60,
            {'1':'GND','2':'IPROG','3':'GND','4':'5V_USB','5':'VBAT','6':'LED_STDBY','7':'LED_CHRG',
             '8':'5V_USB','9':'GND'},footprint=SOIC8,glob_nets=GLOB)
    s.place('Device:R','R3','2.2k',185,45,{'1':'IPROG','2':'GND'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:C','C1','0.1uF',200,45,{'1':'5V_USB','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:C','C2','10uF',215,45,{'1':'VBAT','2':'GND'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:R','R4','330',150,95,{'1':'LED_CHRG','2':'LED_CHRG_K'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:LED','D1','Red',165,95,{'1':'LED_CHRG_K','2':'5V_USB'},footprint=LED0603,glob_nets=GLOB)
    s.place('Device:R','R5','330',185,95,{'1':'LED_STDBY','2':'LED_STDBY_K'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:LED','D2','Green',200,95,{'1':'LED_STDBY_K','2':'5V_USB'},footprint=LED0603,glob_nets=GLOB)
    s.place('Connector_Generic:Conn_01x02','J2','Li-Po 3.7V',55,110,{'1':'VBAT','2':'BATT_NEG'},
            footprint='Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal',glob_nets=GLOB)

    # --- DW01A + FS8205A protection ---
    s.place('Battery_Management:DW01A','U2','DW01A',150,140,
            {'1':'PROT_OD','2':'PROT_CS','3':'PROT_OC','4':None,'5':'PROT_VCC','6':'BATT_NEG'},
            footprint=SOT236,glob_nets=GLOB)
    s.place('Device:C','C3','0.1uF',115,130,{'1':'VBAT','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:R','R6','100',115,150,{'1':'VBAT','2':'PROT_VCC'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:R','R7','2.2k',190,165,{'1':'PROT_CS','2':'GND'},footprint=R0402,glob_nets=GLOB)
    DUAL='Transistor_FET:Q_Dual_NMOS_S1G1S2G2D2D2D1D1'
    s.place(DUAL,'Q1','Si4936BDY (FS8205A alt)',215,140,
            {'1':'BATT_NEG','2':'PROT_OD','7':'PROT_MID','8':'PROT_MID'},
            footprint=SOIC8,glob_nets=GLOB,unit=1,multiunit=True)
    s.place(DUAL,'Q1','Si4936BDY (FS8205A alt)',250,140,
            {'3':'GND','4':'PROT_OC','5':'PROT_MID','6':'PROT_MID'},
            footprint=SOIC8,glob_nets=GLOB,unit=2,multiunit=True)

    # --- boost converter ---
    bx=300
    s.place('Regulator_Switching:MT3608','U3','MT3608',bx,60,
            {'1':'SW','2':'GND','3':'FB','4':'VBAT','5':'VBAT','6':None},
            footprint=SOT236,glob_nets=GLOB)
    s.place('Device:L','L1','22uH',bx-20,40,{'1':'VBAT','2':'SW'},
            footprint='Inductor_SMD:L_Bourns_SRN6045TA',glob_nets=GLOB)
    s.place('Diode:SS34','D3','SS34',bx+25,40,{'2':'SW','1':'5V_BOOST'},
            footprint='Diode_SMD:D_SMA',glob_nets=GLOB)
    s.place('Device:C','C4','22uF',bx-40,60,{'1':'VBAT','2':'GND'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:C','C5','22uF',bx+45,60,{'1':'5V_BOOST','2':'GND'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:R','R8','12k',bx+65,50,{'1':'5V_BOOST','2':'FB'},footprint=R0402,glob_nets=GLOB)
    s.place('Device:R','R9','2.2k',bx+65,72,{'1':'FB','2':'GND'},footprint=R0402,glob_nets=GLOB)

    # --- supply select switch ---
    s.place('Switch:SW_SPDT','SW1','SK-22D02-L5',bx+105,60,
            {'1':'5V_USB','2':'+5V','3':'5V_BOOST'},
            footprint='Button_Switch_THT:SW_Slide_SPDT_Straight_CK_OS102011MS2Q',glob_nets=GLOB)
    s.place('Diode:SS34','D4','SS34',bx+130,90,{'2':'5V_BOOST','1':'+5V'},
            footprint='Diode_SMD:D_SMA',glob_nets=GLOB)

    # --- +2.5V analog LDO ---
    ax=60; ay=200
    s.text(ax-10,ay-25,'ANALOG RAILS',2.5)
    s.place('Regulator_Linear:SPX3819M5-L-2-5','U4','SPX3819M5-2.5',ax,ay,
            {'1':'+5V','2':'GND','3':'+5V','4':'AVDD_BP','5':'AVDD'},footprint=SOT235,glob_nets=GLOB)
    s.place('Device:C','C37','10nF',ax+15,ay+22,{'1':'AVDD_BP','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:C','C6','2.2uF',ax-25,ay,{'1':'+5V','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:C','C7','0.1uF',ax-40,ay,{'1':'+5V','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:C','C8','2.2uF',ax+30,ay,{'1':'AVDD','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.place('Device:C','C9','0.1uF',ax+45,ay,{'1':'AVDD','2':'GND'},footprint=C0402,glob_nets=GLOB)

    # --- charge pump stage 1: +5 -> -5 ---
    cx=160
    s.place('Regulator_SwitchedCapacitor:ICL7660','U5','ICL7660 (stage 1)',cx,ay,
            {'1':None,'2':'CP1_P','3':'GND','4':'CP1_N','5':'-5V','6':None,'7':None,'8':'+5V'},
            footprint=SOIC8,glob_nets=GLOB)
    s.place('Device:C','C10','10uF',cx+30,ay-15,{'1':'CP1_P','2':'CP1_N'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:C','C11','10uF',cx+45,ay,{'1':'-5V','2':'GND'},footprint=C0805,glob_nets=GLOB)

    # --- charge pump stage 2: cascade -> -10V ---
    dx=250
    s.place('Regulator_SwitchedCapacitor:ICL7660','U6','ICL7660 (stage 2)',dx,ay,
            {'1':None,'2':'CP2_P','3':'-5V','4':'CP2_N','5':'-10V','6':'-5V','7':None,'8':'GND'},
            footprint=SOIC8,glob_nets=GLOB)
    s.place('Device:C','C12','10uF',dx+30,ay-15,{'1':'CP2_P','2':'CP2_N'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:C','C13','10uF',dx+45,ay,{'1':'-10V','2':'-5V'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:C','C14','10uF',dx+60,ay,{'1':'-10V','2':'GND'},footprint=C0805,glob_nets=GLOB)

    # --- LM337 -> -2.5V ---
    lx=350
    s.place('Regulator_Linear:LM337_SOT223','U7','LM337',lx,ay,
            {'1':'LM337_ADJ','2':'-10V','3':'AVSS'},
            footprint='Package_TO_SOT_SMD:SOT-223-3_TabPin2',glob_nets=GLOB)
    s.place('Device:R','R10','120',lx+20,ay+20,{'1':'AVSS','2':'LM337_ADJ'},footprint='Resistor_SMD:R_0805_2012Metric',glob_nets=GLOB)
    s.place('Device:R','R11','120',lx+40,ay+20,{'1':'LM337_ADJ','2':'GND'},footprint='Resistor_SMD:R_0805_2012Metric',glob_nets=GLOB)
    s.place('Device:C','C15','10uF',lx-25,ay+20,{'1':'-10V','2':'GND'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:C','C16','10uF',lx+60,ay+20,{'1':'AVSS','2':'GND'},footprint=C0805,glob_nets=GLOB)
    s.place('Device:C','C36','1uF',lx+75,ay+20,{'1':'LM337_ADJ','2':'GND'},footprint=C0402,glob_nets=GLOB)
    s.text(lx-30,ay+45,'Vout = -1.25 * (1 + R11/R10) = -2.5V ; 2x ICL7660 cascade gives -10V rail => ~7.5V headroom',1.4)

    for i,net in enumerate(['GND','+3V3','5V_USB','5V_BOOST','+5V','PROT_VCC','BATT_NEG']):
        s.place('power:PWR_FLAG',f'#FLG{i+1}','PWR_FLAG',60+i*20,300,{'1':net},glob_nets=GLOB)
    return s

# ======================================================================
# MCU SHEET
# ======================================================================
def build_mcu():
    s=Sheet('mcu','mcu.kicad_sch',paper='A2',title='ESP32-WROOM-32U DevKit socket (2x15) + status LEDs')
    s.instpath=f'/{root_uuid}/{U("sheetsym:mcu")}'
    s.ref_offset=200
    s.text(20,18,'MCU  -  ESP32-WROOM-32U DevKit on 2x15 socket',3.0)
    s.text(20,24,'DevKit supplies +3V3 to the board; board supplies +5V to DevKit VIN. USB data is handled by the DevKit.',1.5)

    left=['EN','IO36_NC','IO39_NC','IO34_NC','IO35_NC','IO32_NC','IO33_NC',
          'SRB2','SRB1','DRDY','START','ADS_RESET','PWDN','GND','+5V']
    right=['+3V3','GND','IO15_NC','IO2_NC','IO4_NC','LED_DATA','LED_STATUS','CS',
           'SCLK','MISO','IO21_NC','UART_RX','UART_TX','IO22_NC','MOSI']
    s.place('Connector_Generic:Conn_01x15','J1','DevKit left row (EN..VIN)',80,110,
            {str(i+1):n for i,n in enumerate(left)},
            footprint='Connector_PinSocket_2.54mm:PinSocket_1x15_P2.54mm_Vertical',glob_nets=GLOB)
    s.place('Connector_Generic:Conn_01x15','J2','DevKit right row (3V3..D23)',200,110,
            {str(i+1):n for i,n in enumerate(right)},
            footprint='Connector_PinSocket_2.54mm:PinSocket_1x15_P2.54mm_Vertical',glob_nets=GLOB)
    s.text(60,160,'J1 pin1 = EN  ...  pin15 = VIN     J2 pin1 = 3V3 ... pin15 = GPIO23 (rows run in opposite directions on the socket)',1.4)

    s.place('Device:C','C1','1uF',260,60,{'1':'+3V3','2':'GND'},footprint='Capacitor_SMD:C_0402_1005Metric',glob_nets=GLOB)
    s.place('Device:C','C2','1uF',275,60,{'1':'+5V','2':'GND'},footprint='Capacitor_SMD:C_0402_1005Metric',glob_nets=GLOB)

    # bicolour status indicators (as in v1: two LEDs antiparallel per 120R)
    for i,(drv,refn) in enumerate([('LED_STATUS',1),('LED_DATA',2),('+3V3',3)]):
        x=320+i*45
        s.place('Device:R',f'R{refn}','120',x,60,{'1':drv,'2':f'LEDN{refn}'},
                footprint='Resistor_SMD:R_0402_1005Metric',glob_nets=GLOB)
        s.place('Device:LED',f'D{refn*2-1}','Green',x+18,60,{'2':f'LEDN{refn}','1':'GND'},
                footprint='LED_SMD:LED_0603_1608Metric',glob_nets=GLOB)
        s.place('Device:LED',f'D{refn*2}','Red',x+33,60,{'1':f'LEDN{refn}','2':'GND'},
                footprint='LED_SMD:LED_0603_1608Metric',glob_nets=GLOB)
    return s

# ======================================================================
# ROOT
# ======================================================================
def build_root(children):
    s=Sheet('root','eeg_v1.kicad_sch',paper='A3',title='Root')
    s.uuid=root_uuid
    s.instpath=f'/{root_uuid}'
    s.text(30,30,'ESP-EEG v1 - KiCad rebuild',5.0)
    s.text(30,40,'Rebuilt from Cerelog Inc. v1_schematic.pdf (CC-BY-NC-SA 4.0, non-commercial).',2.0)
    s.text(30,46,'Substitutions vs original: TPD4E1B06 -> USBLC6-2SC6, LM2664 -> 2x ICL7660,',2.0)
    s.text(30,52,'TLV70025 -> SPX3819M5-2.5, TPS72325 -> LM337, on-board ESP32 -> DevKit socket.',2.0)
    y=80
    for name,fn,page in children:
        su=U(f'sheetsym:{name}')
        s.items.append(f'''  (sheet
    (at 40 {y}) (size 70 30)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (dnp no)
    (fields_autoplaced yes)
    (stroke (width 0.1524) (type solid))
    (fill (color 0 0 0 0.0000))
    (uuid {q(su)})
    (property "Sheetname" {q(name)} (at 40 {y-0.7} 0)
      (effects (font (size 1.27 1.27)) (justify left bottom)))
    (property "Sheetfile" {q(fn)} (at 40 {y+30.8} 0)
      (effects (font (size 1.27 1.27)) (justify left top)))
    (instances
      (project "eeg_v1"
        (path {q("/"+root_uuid)} (page "{page}"))
      )
    )
  )''')
        y+=45
    return s

an=build_analog(); pw=build_power(); mc=build_mcu()
rt=build_root([('analog','analog.kicad_sch','2'),('power','power.kicad_sch','3'),('mcu','mcu.kicad_sch','4')])

os.makedirs(OUT,exist_ok=True)
open(f'{OUT}/eeg_v1.kicad_sch','w').write(rt.render('1','/'))
for sh,page,nm in [(an,'2','analog'),(pw,'3','power'),(mc,'4','mcu')]:
    txt=sh.render(page,'').replace('(path "/" (page',f'(path {q("/"+U("sheetsym:"+nm))} (page')
    open(f'{OUT}/{sh.filename}','w').write(txt)

open(f'{OUT}/eeg_v1.kicad_pro','w').write('{\n  "board": {},\n  "meta": {"filename": "eeg_v1.kicad_pro", "version": 3},\n  "schematic": {},\n  "sheets": [],\n  "text_variables": {}\n}\n')
print('symbols:',an.nsym,pw.nsym,mc.nsym)
