#!/usr/bin/env python3
"""Build and sign the Kairo Apple Shortcuts (HealthSync and the one-time history imports).

The shortcuts are generated as Shortcuts property lists and signed with RoutineHub's
public HubSign service, so no Mac is needed. Each shortcut asks two questions when it
is imported (server address and access code), so one signed file works for everybody.

Usage:  python3 tools/build_shortcuts.py worker/public/shortcuts
Requires network access to hubsign.routinehub.services. Only the shortcut logic is sent
for signing, never any health data.

Health type names are the *internal* English identifiers used by the Shortcuts app
(e.g. "Active Calories", not "Active Energy"); they were verified on a real device.
"""
import json, os, plistlib, sys, urllib.request, uuid

SHORTCUT_VERSION = "1.0.0"
OBJ = "￼"  # placeholder character that Shortcuts replaces with a variable


def U():
    return str(uuid.uuid4()).upper()


def out_ref(uid, name):
    return {"Value": {"OutputUUID": uid, "Type": "ActionOutput", "OutputName": name},
            "WFSerializationType": "WFTextTokenAttachment"}


def var_ref(name):
    return {"Value": {"VariableName": name, "Type": "Variable"}, "WFSerializationType": "WFTextTokenAttachment"}


def text_with_var(before, var, after=""):
    return {"Value": {"string": before + OBJ + after,
                      "attachmentsByRange": {f"{{{len(before)}, 1}}": {"VariableName": var, "Type": "Variable"}}},
            "WFSerializationType": "WFTextTokenString"}


def plain_text(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}


def act(ident, **params):
    return {"WFWorkflowActionIdentifier": ident, "WFWorkflowActionParameters": params}


def config_block():
    """Actions 0-3: two text actions filled by the import questions, saved in variables."""
    a, b = U(), U()
    return [
        act("is.workflow.actions.gettext", UUID=a, WFTextActionText=""),
        act("is.workflow.actions.setvariable", WFInput=out_ref(a, "Testo"), WFVariableName="kairo_server"),
        act("is.workflow.actions.gettext", UUID=b, WFTextActionText=""),
        act("is.workflow.actions.setvariable", WFInput=out_ref(b, "Testo"), WFVariableName="kairo_codice"),
    ]


IMPORT_QUESTIONS = [
    {"ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText",
     "Text": "Indirizzo del tuo server Kairo (es. https://kairo.tuonome.workers.dev)", "DefaultValue": "https://"},
    {"ActionIndex": 2, "Category": "Parameter", "ParameterKey": "WFTextActionText",
     "Text": "Il tuo codice di accesso Kairo", "DefaultValue": ""},
]


def metric_block(key, hk_type, days, with_end=False, group=None):
    """Find Health Samples -> variable; values and ISO dates joined with ';'."""
    acts, keys = [], []
    fid = U()
    extra = {"WFHKSampleFilteringGroupBy": group} if group else {}
    acts.append(act("is.workflow.actions.filter.health.quantity", UUID=fid, **extra,
        WFContentItemLimitEnabled=False, WFContentItemSortProperty="Start Date", WFContentItemSortOrder="Oldest First",
        WFContentItemFilter={"Value": {
            "WFActionParameterFilterPrefix": 1, "WFContentPredicateBoundedDate": False,
            "WFActionParameterFilterTemplates": [
                {"Bounded": True, "Operator": 4, "Removable": False, "Property": "Type",
                 "Values": {"Enumeration": {"Value": hk_type, "WFSerializationType": "WFStringSubstitutableState"}}},
                {"Bounded": True, "Operator": 1001, "Removable": False, "Property": "Start Date",
                 "Values": {"Unit": 16, "Number": str(days)}},  # Unit 16 = days
            ]}, "WFSerializationType": "WFContentPredicateTableTemplate"}))
    samples = f"{key}_campioni"
    acts.append(act("is.workflow.actions.setvariable", WFInput=out_ref(fid, "Campioni di dati sanitari"), WFVariableName=samples))

    def prop(prop_name, suffix, is_date):
        pid = U()
        acts.append(act("is.workflow.actions.properties.health.quantity", UUID=pid,
                        WFInput=var_ref(samples), WFContentItemPropertyName=prop_name))
        src_uid, src_name = pid, prop_name
        if is_date:
            did = U()
            acts.append(act("is.workflow.actions.format.date", UUID=did, WFDateFormatStyle="ISO 8601", WFISO8601IncludeTime=True,
                WFDate={"Value": {"string": OBJ, "attachmentsByRange": {"{0, 1}": {"OutputUUID": pid, "Type": "ActionOutput", "OutputName": prop_name}}},
                        "WFSerializationType": "WFTextTokenString"}))
            src_uid, src_name = did, "Data formattata"
        cid = U()
        acts.append(act("is.workflow.actions.text.combine", UUID=cid, WFTextSeparator="Custom", WFTextCustomSeparator=";",
                        text=out_ref(src_uid, src_name)))
        name = f"{key}_{suffix}"
        acts.append(act("is.workflow.actions.setvariable", WFInput=out_ref(cid, "Testo combinato"), WFVariableName=name))
        keys.append(name)

    prop("Value", "valori", False)
    prop("Start Date", "date", True)
    if with_end:
        prop("End Date", "fine", True)
    return acts, keys


def send_block(keys, module, backup_suffix):
    """Build the JSON dictionary, keep a backup copy in iCloud Drive and POST it to the server."""
    acts = []
    did = U()
    item = lambda k, v: {"WFItemType": 0, "WFKey": plain_text(k), "WFValue": v}
    items = [item("modulo", plain_text(module)), item("versione", plain_text(SHORTCUT_VERSION)),
             item("esportato", {"Value": {"string": OBJ, "attachmentsByRange": {"{0, 1}": {"Type": "CurrentDate",
                  "Aggrandizements": [{"Type": "WFDateFormatVariableAggrandizement", "WFDateFormatStyle": "ISO 8601", "WFISO8601IncludeTime": True}]}}},
                  "WFSerializationType": "WFTextTokenString"})]
    items += [item(k, text_with_var("", k)) for k in keys]
    acts.append(act("is.workflow.actions.dictionary", UUID=did,
                    WFItems={"Value": {"WFDictionaryFieldValueItems": items}, "WFSerializationType": "WFDictionaryFieldValue"}))
    nid = U()
    acts.append(act("is.workflow.actions.setitemname", UUID=nid, WFInput=out_ref(did, "Dizionario"),
        WFName={"Value": {"string": OBJ + f"_{backup_suffix}.json", "attachmentsByRange": {"{0, 1}": {"Type": "CurrentDate",
            "Aggrandizements": [{"Type": "WFDateFormatVariableAggrandizement", "WFDateFormatStyle": "Custom", "WFISO8601IncludeTime": False, "WFDateFormat": "yyyy-MM-dd_HH-mm"}]}}},
            "WFSerializationType": "WFTextTokenString"}))
    acts.append(act("is.workflow.actions.documentpicker.save", UUID=U(), WFInput=out_ref(nid, "Elemento rinominato"),
                    WFAskWhereToSave=False, WFFileDestinationPath="Kairo/"))
    acts.append(act("is.workflow.actions.downloadurl", UUID=U(),
        WFURL=text_with_var("", "kairo_server", "/api/ingest"), WFHTTPMethod="POST", WFHTTPBodyType="File",
        WFRequestVariable=out_ref(did, "Dizionario"),
        WFHTTPHeaders={"Value": {"WFDictionaryFieldValueItems": [
            item("Authorization", text_with_var("Bearer ", "kairo_codice")),
            item("Content-Type", plain_text("application/json"))]}, "WFSerializationType": "WFDictionaryFieldValue"}))
    return acts


def shortcut(actions, color):
    return {
        "WFWorkflowMinimumClientVersionString": "1106", "WFWorkflowMinimumClientVersion": 1106, "WFWorkflowClientVersion": "4711",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": color, "WFWorkflowIconGlyphNumber": 61440},
        "WFWorkflowActions": actions, "WFWorkflowInputContentItemClasses": ["WFStringContentItem"],
        "WFWorkflowOutputContentItemClasses": [], "WFWorkflowHasOutputFallback": False,
        "WFWorkflowImportQuestions": IMPORT_QUESTIONS, "WFQuickActionSurfaces": [],
        "WFWorkflowTypes": [], "WFWorkflowHasShortcutInputVariables": False,
    }


def build(name, suffix, metrics, color):
    actions, keys = config_block(), []
    for m in metrics:
        a, k = metric_block(**m)
        actions += a
        keys += k
    actions += send_block(keys, name, suffix)
    return shortcut(actions, color)


def sign(name, sc, outdir):
    xml = plistlib.dumps(sc, fmt=plistlib.FMT_XML).decode()
    req = urllib.request.Request("https://hubsign.routinehub.services/sign",
        data=json.dumps({"shortcutName": name, "shortcut": xml}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "cherri/2.2.0"})
    data = urllib.request.urlopen(req, timeout=90).read()
    if data[:4] != b"AEA1":
        raise SystemExit(f"{name}: signing failed: {data[:200]!r}")
    with open(os.path.join(outdir, f"{name}.shortcut"), "wb") as f:
        f.write(data)
    print(f"{name}: signed, {len(data)} bytes, {len(sc['WFWorkflowActions'])} actions")


D = 3  # daily window: 3 days of overlap, duplicates are removed by the server
DAILY = [
    # recovery
    dict(key="hrv", hk_type="Heart Rate Variability", days=D),
    dict(key="fcr", hk_type="Resting Heart Rate", days=D),
    dict(key="fc_camminata", hk_type="Walking Heart Rate Average", days=D),
    dict(key="resp", hk_type="Respiratory Rate", days=D),
    dict(key="spo2", hk_type="Oxygen Saturation", days=D),
    dict(key="vo2max", hk_type="VO2 Max", days=60),
    # activity (grouped per day = de-duplicated between iPhone and Watch)
    dict(key="passi", hk_type="Steps", days=D, group="Day"),
    dict(key="kcal_attive", hk_type="Active Calories", days=D, group="Day"),
    dict(key="kcal_riposo", hk_type="Resting Calories", days=D, group="Day"),
    dict(key="dist_piedi", hk_type="Walking + Running Distance", days=D, group="Day"),
    dict(key="piani", hk_type="Flights Climbed", days=D, group="Day"),
    dict(key="dist_bici", hk_type="Cycling Distance", days=D, group="Day"),
    dict(key="dist_nuoto", hk_type="Swimming Distance", days=D, group="Day"),
    dict(key="bracciate", hk_type="Swimming Stroke Count", days=D, group="Day"),
    # heart rate samples and hourly active calories (to recognise training sessions)
    dict(key="fc", hk_type="Heart Rate", days=2),
    dict(key="kcal_ora", hk_type="Active Calories", days=2, group="Hour"),
    # sleep stages
    dict(key="sonno", hk_type="Sleep", days=2, with_end=True),
    # nutrition (filled only if an app writes it to Apple Health)
    dict(key="kcal_cibo", hk_type="Dietary Calories", days=D, group="Day"),
    dict(key="proteine", hk_type="Protein", days=D, group="Day"),
    dict(key="carboidrati", hk_type="Carbohydrates", days=D, group="Day"),
    dict(key="grassi", hk_type="Total Fat", days=D, group="Day"),
    dict(key="acqua", hk_type="Water", days=D, group="Day"),
    # body
    dict(key="peso", hk_type="Weight", days=7),
    dict(key="grasso_pct", hk_type="Body Fat Percentage", days=30),
    dict(key="massa_magra", hk_type="Lean Body Mass", days=30),
    dict(key="bmi", hk_type="Body Mass Index", days=30),
]

# One-time history import, split in parts so each stays within the Shortcuts memory limit.
HISTORY = {
    "HealthSync_Storico_1A": ("storico1a", [
        dict(key="hrv", hk_type="Heart Rate Variability", days=365),
        dict(key="fcr", hk_type="Resting Heart Rate", days=365),
        dict(key="fc_camminata", hk_type="Walking Heart Rate Average", days=365)]),
    "HealthSync_Storico_1B": ("storico1b", [
        dict(key="vo2max", hk_type="VO2 Max", days=730),
        dict(key="peso", hk_type="Weight", days=730),
        dict(key="grasso_pct", hk_type="Body Fat Percentage", days=730),
        dict(key="massa_magra", hk_type="Lean Body Mass", days=730),
        dict(key="bmi", hk_type="Body Mass Index", days=730)]),
    "HealthSync_Storico_1C": ("storico1c", [
        dict(key=k, hk_type=t, days=365, group="Day") for k, t in [
            ("passi", "Steps"), ("kcal_attive", "Active Calories"), ("kcal_riposo", "Resting Calories"),
            ("dist_piedi", "Walking + Running Distance"), ("piani", "Flights Climbed"), ("dist_bici", "Cycling Distance"),
            ("dist_nuoto", "Swimming Distance"), ("kcal_cibo", "Dietary Calories"), ("proteine", "Protein")]]),
    "HealthSync_Storico_2": ("storico2", [
        dict(key="sonno", hk_type="Sleep", days=45, with_end=True),
        dict(key="spo2", hk_type="Oxygen Saturation", days=30),
        dict(key="resp", hk_type="Respiratory Rate", days=21),
        dict(key="kcal_ora", hk_type="Active Calories", days=14, group="Hour")]),
}

ORANGE, PURPLE = 4271458815, 3679049983

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "shortcuts"
    os.makedirs(out, exist_ok=True)
    sign("HealthSync", build("HealthSync", "completo", DAILY, ORANGE), out)
    for name, (suffix, metrics) in HISTORY.items():
        sign(name, build(name, suffix, metrics, PURPLE), out)
