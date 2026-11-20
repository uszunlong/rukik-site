/* libintl.c — identity-passthrough stub implementation.
 * No catalogs are ever loaded: every lookup returns the msgid itself,
 * which is exactly the behavior of real libintl when no translation
 * exists. Returning the input pointer (not a copy) also preserves
 * fcitx-utils i18n.cpp's pointer-equality "untranslated" check.
 * Generated in-script by build-libime-ios.sh. */
#include "libintl.h"

#include <stddef.h>

char *gettext(const char *msgid) { return (char *)msgid; }

char *dgettext(const char *domainname, const char *msgid) {
    (void)domainname;
    return (char *)msgid;
}

char *dcgettext(const char *domainname, const char *msgid, int category) {
    (void)category;
    return dgettext(domainname, msgid);
}

char *ngettext(const char *msgid1, const char *msgid2, unsigned long int n) {
    return (char *)(n == 1 ? msgid1 : msgid2);
}

char *dngettext(const char *domainname, const char *msgid1,
                const char *msgid2, unsigned long int n) {
    (void)domainname;
    return ngettext(msgid1, msgid2, n);
}

char *dcngettext(const char *domainname, const char *msgid1,
                 const char *msgid2, unsigned long int n, int category) {
    (void)category;
    return dngettext(domainname, msgid1, msgid2, n);
}

char *textdomain(const char *domainname) {
    static char current[64] = "messages";
    if (domainname) {
        size_t i = 0;
        while (domainname[i] && i + 1 < sizeof(current)) {
            current[i] = domainname[i];
            i++;
        }
        current[i] = '\0';
    }
    return current;
}

char *bindtextdomain(const char *domainname, const char *dirname) {
    (void)domainname;
    return (char *)(dirname ? dirname : "");
}

char *bind_textdomain_codeset(const char *domainname, const char *codeset) {
    (void)domainname;
    return (char *)(codeset ? codeset : "");
}
